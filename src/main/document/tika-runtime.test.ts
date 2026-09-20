import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const existsSync = vi.hoisted(() => vi.fn())
const readFileSync = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync,
  readFileSync,
}))

import { resolveTikaRuntimeOptions, TikaRuntime } from './tika-runtime'

describe('resolveTikaRuntimeOptions', () => {
  afterEach(() => {
    existsSync.mockReset()
    readFileSync.mockReset()
  })

  it('resolves packaged portable paths below the architecture resource root', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(
      JSON.stringify({
        javaBinary: 'runtime/java/bin/java.exe',
        platform: `${process.platform}-${process.arch}`,
        schemaVersion: 1,
        tikaJar: 'runtime/tika/tika-server-standard-4.0.0.jar',
        tikaVersion: '4.0.0',
      }),
    )

    const result = resolveTikaRuntimeOptions({
      appPath: '/application',
      isPackaged: true,
      resourcesPath: '/resources',
    })

    const platform = `${process.platform}-${process.arch}`
    expect(result.javaBinary).toBe(
      join('/resources/tika-runtime', platform, 'runtime/java/bin/java.exe'),
    )
    expect(result.tikaJar).toBe(
      join(
        '/resources/tika-runtime',
        platform,
        'runtime/tika/tika-server-standard-4.0.0.jar',
      ),
    )
    expect(result.configPath).toBe(
      join('/resources/tika-runtime', platform, 'tika-config.json'),
    )
  })

  it('rejects absolute paths from a packaged manifest', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(
      JSON.stringify({
        javaBinary: '/tmp/java',
        platform: `${process.platform}-${process.arch}`,
        schemaVersion: 1,
        tikaJar: 'runtime/tika/tika-server-standard-4.0.0.jar',
        tikaVersion: '4.0.0',
      }),
    )

    expect(() =>
      resolveTikaRuntimeOptions({
        appPath: '/application',
        isPackaged: true,
        resourcesPath: '/resources',
      }),
    ).toThrow('Tika 运行时清单无效')
  })

  it('rejects packaged manifest paths that escape the architecture resource root', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(
      JSON.stringify({
        javaBinary: '../../java',
        platform: `${process.platform}-${process.arch}`,
        schemaVersion: 1,
        tikaJar: 'runtime/tika/tika-server-standard-4.0.0.jar',
        tikaVersion: '4.0.0',
      }),
    )

    expect(() =>
      resolveTikaRuntimeOptions({
        appPath: '/application',
        isPackaged: true,
        resourcesPath: '/resources',
      }),
    ).toThrow('Tika 运行时清单无效')
  })

  it('reports how to prepare a missing development runtime', async () => {
    existsSync.mockReturnValue(false)
    const options = resolveTikaRuntimeOptions({
      appPath: '/application',
      isPackaged: false,
      resourcesPath: '/resources',
    })
    const runtime = new TikaRuntime(options)

    await expect(runtime.run(async () => undefined)).rejects.toThrow(
      'Tika 开发运行时未准备，请先运行 node scripts/tika-p0/prepare-runtime.mjs',
    )
    expect(runtime.state).toBe('failed')
  })

  it('reports missing packaged resources without suggesting developer commands', async () => {
    existsSync.mockReturnValue(false)
    const runtime = new TikaRuntime(
      resolveTikaRuntimeOptions({
        appPath: '/application',
        isPackaged: true,
        resourcesPath: '/resources',
      }),
    )

    await expect(runtime.run(async () => undefined)).rejects.toThrow(
      '内置 Tika 运行时不完整，请重新安装应用',
    )
  })
})
