import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparePandocDocument } from './pandoc-document'
import { PandocRuntime, resolvePandocRuntimeOptions } from './pandoc-runtime'

const options = resolvePandocRuntimeOptions({
  appPath: resolve('.'),
  isPackaged: false,
  resourcesPath: '/unused',
})

describe.skipIf(
  !existsSync(options.binaryPath) || !existsSync(options.referencePath),
)('Pandoc Word export integration', () => {
  it('converts GFM through the inspected AST into a DOCX', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'slidemind-pandoc-integration-'),
    )
    const outputPath = join(directory, 'output.docx')
    const runtime = new PandocRuntime(options)
    try {
      const ast = await runtime.parseMarkdown(
        '# 标题\n\n- first\n- second\n\n| A | B |\n| - | - |\n| 1 | 2 |',
        'integration-parse',
      )
      const prepared = await preparePandocDocument(
        ast,
        async () => {
          throw new Error('fixture has no image')
        },
        1024,
      )
      await runtime.writeDocx(
        prepared.document,
        outputPath,
        'integration-write',
      )

      const bytes = await readFile(outputPath)
      expect(bytes.subarray(0, 2).toString()).toBe('PK')
      expect(bytes.includes(Buffer.from('word/document.xml'))).toBe(true)
    } finally {
      await runtime.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 15_000)
})
