import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { preparePandocDocument } from './pandoc-document'
import { PandocRuntime, resolvePandocRuntimeOptions } from './pandoc-runtime'

const options = resolvePandocRuntimeOptions({
  appPath: resolve('.'),
  isPackaged: false,
  resourcesPath: '/unused',
})
const execFileAsync = promisify(execFile)

function readZipEntries(bytes: Buffer): Map<string, Buffer> {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const endOffset = bytes.lastIndexOf(endSignature)
  if (endOffset < 0) throw new Error('DOCX has no ZIP end record')
  const entryCount = bytes.readUInt16LE(endOffset + 10)
  let centralOffset = bytes.readUInt32LE(endOffset + 16)
  const entries = new Map<string, Buffer>()
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error('DOCX has an invalid ZIP directory')
    }
    const method = bytes.readUInt16LE(centralOffset + 10)
    const compressedSize = bytes.readUInt32LE(centralOffset + 20)
    const nameLength = bytes.readUInt16LE(centralOffset + 28)
    const extraLength = bytes.readUInt16LE(centralOffset + 30)
    const commentLength = bytes.readUInt16LE(centralOffset + 32)
    const localOffset = bytes.readUInt32LE(centralOffset + 42)
    const name = bytes
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString('utf8')
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize)
    if (method !== 0 && method !== 8) {
      throw new Error(`DOCX uses unsupported ZIP method ${method}`)
    }
    entries.set(name, method === 0 ? compressed : inflateRawSync(compressed))
    centralOffset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

describe.skipIf(
  process.env.SLIDEMIND_PANDOC_INTEGRATION !== '1' &&
    (!existsSync(options.binaryPath) || !existsSync(options.referencePath)),
)('Pandoc Word export integration', () => {
  it('preserves headings, numbering, tables, links and media relationships', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'slidemind-pandoc-integration-'),
    )
    const outputPath = join(directory, 'output.docx')
    const runtime = new PandocRuntime(options)
    try {
      const version = await execFileAsync(options.binaryPath, ['--version'])
      expect(version.stdout).toMatch(/^pandoc 3\.11(?:\s|$)/)
      const ast = await runtime.parseMarkdown(
        '# 标题\n\n3. third\n4. fourth\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[OpenAI](https://openai.com)\n\n![图](image.png)',
        'integration-parse',
      )
      const prepared = await preparePandocDocument(
        ast,
        async () => ({
          bytes: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          ),
          mimeType: 'image/png',
        }),
        1024,
      )
      await runtime.writeDocx(
        prepared.document,
        outputPath,
        'integration-write',
      )

      const bytes = await readFile(outputPath)
      const entries = readZipEntries(bytes)
      const documentXml = entries.get('word/document.xml')?.toString('utf8')
      const documentRelationships = entries
        .get('word/_rels/document.xml.rels')
        ?.toString('utf8')
      const numberingXml = entries.get('word/numbering.xml')?.toString('utf8')

      expect(documentXml).toContain('标题')
      expect(documentXml).toContain('third')
      expect(documentXml).toContain('<w:tbl>')
      expect(documentXml).toContain('r:embed=')
      expect(numberingXml).toContain('w:start w:val="3"')
      expect(documentRelationships).toContain('Target="https://openai.com"')
      expect(documentRelationships).toMatch(/Target="media\/[^"/]+\.png"/)
      expect(
        [...entries.keys()].some((name) =>
          /^word\/media\/[^/]+\.png$/.test(name),
        ),
      ).toBe(true)
    } finally {
      await runtime.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 15_000)
})
