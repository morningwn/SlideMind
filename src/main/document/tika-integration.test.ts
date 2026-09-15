import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TikaClient } from './tika-client'
import { TikaRuntime } from './tika-runtime'

const repositoryRoot = resolve(__dirname, '../../..')
const runtimeRoot = resolve(
  repositoryRoot,
  '.tika-p0-runtime',
  `${process.platform}-${process.arch}`
)
const preparedPath = resolve(runtimeRoot, 'prepared-runtime.json')
const integrationEnabled = process.env.SLIDEMIND_TIKA_INTEGRATION === '1' && existsSync(preparedPath)

describe.skipIf(!integrationEnabled)('fixed Tika runtime integration', () => {
  it('starts the pinned runtime and extracts the fixed DOC and DOCX fixtures', async () => {
    const prepared = JSON.parse(readFileSync(preparedPath, 'utf8')) as {
      javaBinary: string
      tikaJar: string
      tikaVersion: string
    }
    const runtime = new TikaRuntime({
      configPath: resolve(repositoryRoot, 'scripts/tika-p0/tika-config.json'),
      idleTimeoutMs: 60_000,
      javaBinary: prepared.javaBinary,
      tikaJar: prepared.tikaJar,
      tikaVersion: prepared.tikaVersion
    })
    try {
      const client = new TikaClient()
      for (const file of ['simple-content.doc', 'simple-content.docx']) {
        const bytes = await readFile(resolve(repositoryRoot, 'scripts/tika-p0/fixtures', file))
        const result = await runtime.run((baseUrl) => client.parse(baseUrl, bytes, file))
        expect(result.mimeType).toMatch(/msword|wordprocessingml\.document/)
        expect(result.entries[0]['tk:content']).toContain('SlideMind')
      }
    } finally {
      await runtime.stop()
    }
  }, 45_000)
})
