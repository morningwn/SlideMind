import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateReferenceDocument, validateRuntime } from './after-pack.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'slidemind-pandoc-package-test-'))
  roots.push(root)
  await mkdir(join(root, 'runtime'), { recursive: true })
  const binary = Buffer.alloc(4096)
  binary.writeUInt32LE(0xfeedfacf, 0)
  binary.writeUInt32LE(0x0100000c, 4)
  await writeFile(join(root, 'runtime/pandoc'), binary)
  await writeFile(join(root, 'runtime/COPYING.md'), 'GPL-2.0-or-later')
  await writeFile(join(root, 'runtime/COPYRIGHT'), 'notices')
  await writeFile(join(root, 'runtime/pandoc-3.11.tar.gz'), 'source')
  await writeFile(
    join(root, 'prepared-runtime.json'),
    JSON.stringify({
      schemaVersion: 1,
      platform: 'darwin-arm64',
      pandocVersion: '3.11',
      binary: 'runtime/pandoc',
      correspondingSource: {
        path: 'runtime/pandoc-3.11.tar.gz',
        url: 'https://github.com/jgm/pandoc/archive/refs/tags/3.11.tar.gz',
        bytes: 9018272,
        sha256:
          '61d05e7fc57e995a61367bee1bb73a8bb278cda3c787b7e4e27b30037e17aeed',
      },
      fileDescription: 'Mach-O 64-bit executable arm64',
    }),
  )
  return root
}

describe('Pandoc packaging validation', () => {
  it('accepts a matching binary, notices and corresponding source', async () => {
    const root = await fixture()
    const source = Buffer.from('source')
    await expect(
      validateRuntime(root, 'darwin-arm64', {
        size: source.length,
        sha256: createHash('sha256').update(source).digest('hex'),
      }),
    ).resolves.toMatchObject({ binaryPath: join(root, 'runtime/pandoc') })
  })

  it('rejects an unverified corresponding-source archive', async () => {
    const root = await fixture()
    await expect(validateRuntime(root, 'darwin-arm64')).rejects.toThrow(
      'source archive',
    )
  })

  it('rejects mismatched target metadata and escaping paths', async () => {
    const root = await fixture()
    await expect(validateRuntime(root, 'darwin-x64')).rejects.toThrow(
      'manifest',
    )
    await writeFile(
      join(root, 'prepared-runtime.json'),
      JSON.stringify({
        schemaVersion: 1,
        platform: 'darwin-arm64',
        pandocVersion: '3.11',
        binary: '../pandoc',
        correspondingSource: {
          path: 'runtime/pandoc-3.11.tar.gz',
          url: 'https://github.com/jgm/pandoc/archive/refs/tags/3.11.tar.gz',
          bytes: 9018272,
          sha256:
            '61d05e7fc57e995a61367bee1bb73a8bb278cda3c787b7e4e27b30037e17aeed',
        },
        fileDescription: 'Mach-O 64-bit executable arm64',
      }),
    )
    await expect(validateRuntime(root, 'darwin-arm64')).rejects.toThrow(
      'escapes',
    )
  })

  it('rejects a runtime prepared from the wrong Pandoc version', async () => {
    const root = await fixture()
    const manifestPath = join(root, 'prepared-runtime.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.pandocVersion = '3.10'
    await writeFile(manifestPath, JSON.stringify(manifest))

    await expect(validateRuntime(root, 'darwin-arm64')).rejects.toThrow(
      'manifest',
    )
  })

  it('requires a DOCX reference archive', async () => {
    const root = await fixture()
    const referencePath = join(root, 'reference.docx')
    await writeFile(referencePath, Buffer.from('PK\u0003\u0004fixture'))
    await expect(
      validateReferenceDocument(referencePath),
    ).resolves.toBeUndefined()
    await writeFile(referencePath, 'not a docx')
    await expect(validateReferenceDocument(referencePath)).rejects.toThrow(
      'DOCX',
    )
  })
})
