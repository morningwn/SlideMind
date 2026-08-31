import { gunzip } from 'node:zlib'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDiagnosticBundle,
  diagnosticBundleFileName,
  writeDiagnosticBundle,
  type DiagnosticEnvironment
} from './diagnostics'

const temporaryDirectories: string[] = []
const environment: DiagnosticEnvironment = {
  application: { isPackaged: true, name: 'SlideMind', version: '0.1.0' },
  runtime: {
    arch: 'arm64',
    chrome: '1',
    electron: '1',
    node: '1',
    platform: 'darwin'
  }
}

function gunzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzip(input, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ))
})

describe('diagnostic bundle', () => {
  it('uses a filesystem-safe timestamped name', () => {
    expect(diagnosticBundleFileName(new Date('2026-08-31T15:20:30.000Z'))).toBe(
      'SlideMind-diagnostics-20260831T152030Z.json.gz'
    )
  })

  it('contains only application log files and non-sensitive runtime metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-diagnostics-'))
    temporaryDirectories.push(directory)
    await writeFile(
      join(directory, 'slidemind.log'),
      `{"event":"app.started","apiKey":"plain","path":"${homedir()}/project"}\n`
    )
    await writeFile(join(directory, 'slidemind.1.log'), '{"event":"old"}\n')
    await writeFile(join(directory, 'unrelated.txt'), 'do not export')

    const compressed = await createDiagnosticBundle(
      directory,
      environment,
      new Date('2026-08-31T15:20:30.000Z')
    )
    const bundle = JSON.parse((await gunzipBuffer(compressed)).toString('utf8')) as {
      application: unknown
      generatedAt: string
      logging: { fileCount: number; files: Array<{ name: string; content: string }> }
      runtime: unknown
      schemaVersion: number
    }

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-08-31T15:20:30.000Z',
      application: environment.application,
      runtime: environment.runtime,
      logging: { fileCount: 2 }
    })
    expect(bundle.logging.files.map((file) => file.name)).toEqual([
      'slidemind.log',
      'slidemind.1.log'
    ])
    expect(JSON.stringify(bundle)).not.toContain('do not export')
    expect(JSON.stringify(bundle)).not.toContain('plain')
    expect(JSON.stringify(bundle)).not.toContain(homedir())
  })

  it('refuses to overwrite a symbolic link', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-diagnostics-'))
    temporaryDirectories.push(directory)
    const targetPath = join(directory, 'target.json.gz')
    const outputPath = join(directory, 'diagnostics.json.gz')
    await writeFile(targetPath, 'keep')
    await symlink(targetPath, outputPath)

    await expect(writeDiagnosticBundle(outputPath, directory, environment)).rejects.toThrow(
      '诊断包目标必须是普通文件'
    )
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('keep')
  })
})
