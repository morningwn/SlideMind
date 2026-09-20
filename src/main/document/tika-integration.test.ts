import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TikaClient } from './tika-client'
import { TikaRuntime } from './tika-runtime'

const repositoryRoot = resolve(__dirname, '../../..')
const runtimeRoot = resolve(
  process.env.SLIDEMIND_TIKA_RUNTIME_ROOT ??
    resolve(
      repositoryRoot,
      'out/.tika-p0-runtime',
      `${process.platform}-${process.arch}`,
    ),
)
const preparedPath = resolve(runtimeRoot, 'prepared-runtime.json')
const integrationEnabled = process.env.SLIDEMIND_TIKA_INTEGRATION === '1'

describe.skipIf(!integrationEnabled)('fixed Tika runtime integration', () => {
  it('starts the pinned runtime and extracts the fixed office and PDF fixtures', async () => {
    expect(
      existsSync(preparedPath),
      'Prepare the requested runtime before integration testing',
    ).toBe(true)
    const prepared = JSON.parse(readFileSync(preparedPath, 'utf8')) as {
      javaBinary: string
      tikaJar: string
      tikaVersion: string
    }
    const runtime = new TikaRuntime({
      configPath: resolve(repositoryRoot, 'scripts/tika-p0/tika-config.json'),
      idleTimeoutMs: 60_000,
      javaBinary: resolve(runtimeRoot, prepared.javaBinary),
      tikaJar: resolve(runtimeRoot, prepared.tikaJar),
      tikaVersion: prepared.tikaVersion,
    })
    try {
      const client = new TikaClient()
      const expectations = JSON.parse(
        await readFile(
          resolve(repositoryRoot, 'scripts/tika-p0/fixtures/expectations.json'),
          'utf8',
        ),
      ) as { samples: Array<{ file: string; requiredText: string[] }> }
      const fixtures = [
        {
          file: 'simple-content.doc',
          marker: 'SLIDEMIND TIKA P0 END',
          mimeType: 'application/msword',
        },
        {
          file: 'simple-content.docx',
          marker: 'SLIDEMIND TIKA P0 END',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        {
          file: 'complex-content.docx',
          marker: 'PAGE TWO CONTENT',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        {
          file: 'simple-spreadsheet.xls',
          marker: 'SLIDEMIND TIKA EXCEL END',
          mimeType: 'application/vnd.ms-excel',
        },
        {
          file: 'simple-spreadsheet.xlsx',
          marker: 'SLIDEMIND TIKA EXCEL END',
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        {
          file: 'simple-content.pdf',
          marker: 'SLIDEMIND TIKA P0 END',
          mimeType: 'application/pdf',
        },
      ]
      for (const fixture of fixtures) {
        const { file } = fixture
        const bytes = await readFile(
          resolve(repositoryRoot, 'scripts/tika-p0/fixtures', file),
        )
        for (const requestFile of [
          file,
          `中文教材·课堂 (1)'📖${extname(file)}`,
        ]) {
          const result = await runtime.run((baseUrl) =>
            client.parse(baseUrl, bytes, requestFile),
          )
          expect(result.mimeType).toBe(fixture.mimeType)
          expect(result.entries[0]['tk:content']).toContain(fixture.marker)
          for (const marker of expectations.samples.find(
            (sample) => sample.file === file,
          )!.requiredText) {
            expect(result.entries[0]['tk:content'], requestFile).toContain(
              marker,
            )
          }
        }
      }
    } finally {
      await runtime.stop()
    }
  }, 45_000)
})
