import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const existsSync = vi.hoisted(() => vi.fn())
const readFileSync = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync,
  readFileSync
}))

import { resolveTikaRuntimeOptions } from './tika-runtime'

describe('resolveTikaRuntimeOptions', () => {
  afterEach(() => {
    existsSync.mockReset()
    readFileSync.mockReset()
  })

  it('resolves packaged portable paths below the architecture resource root', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(JSON.stringify({
      javaBinary: 'runtime/java/bin/java.exe',
      platform: `${process.platform}-${process.arch}`,
      schemaVersion: 1,
      tikaJar: 'runtime/tika/tika-server-standard-4.0.0.jar',
      tikaVersion: '4.0.0'
    }))

    const result = resolveTikaRuntimeOptions({
      appPath: '/application',
      isPackaged: true,
      resourcesPath: '/resources'
    })

    const platform = `${process.platform}-${process.arch}`
    expect(result.javaBinary).toBe(join('/resources/tika-runtime', platform, 'runtime/java/bin/java.exe'))
    expect(result.tikaJar).toBe(join(
      '/resources/tika-runtime',
      platform,
      'runtime/tika/tika-server-standard-4.0.0.jar'
    ))
    expect(result.configPath).toBe(join('/resources/tika-runtime', platform, 'tika-config.json'))
  })

  it('rejects absolute paths from a packaged manifest', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(JSON.stringify({
      javaBinary: '/tmp/java',
      platform: `${process.platform}-${process.arch}`,
      schemaVersion: 1,
      tikaJar: 'runtime/tika/tika-server-standard-4.0.0.jar',
      tikaVersion: '4.0.0'
    }))

    expect(() => resolveTikaRuntimeOptions({
      appPath: '/application',
      isPackaged: true,
      resourcesPath: '/resources'
    })).toThrow('Tika 运行时清单无效')
  })

  it('rejects packaged manifest paths that escape the architecture resource root', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(JSON.stringify({
      javaBinary: '../../java',
      platform: `${process.platform}-${process.arch}`,
      schemaVersion: 1,
      tikaJar: 'runtime/tika/tika-server-standard-4.0.0.jar',
      tikaVersion: '4.0.0'
    }))

    expect(() => resolveTikaRuntimeOptions({
      appPath: '/application',
      isPackaged: true,
      resourcesPath: '/resources'
    })).toThrow('Tika 运行时清单无效')
  })
})
