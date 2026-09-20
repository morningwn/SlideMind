import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
const argv = process.argv

beforeEach(() => {
  vi.resetModules()
  spawn.mockReset()
  spawn.mockImplementation(() => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('exit', 0))
    return child
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  process.argv = [process.execPath, 'scripts/test.mjs']
})
afterEach(() => {
  process.argv = argv
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const scripts = () => spawn.mock.calls.map(([, args]) => args[0])

describe('unified test runner', () => {
  it('runs base suites without downloading runtimes', async () => {
    await import('./test.mjs')
    expect(scripts()).toEqual([
      expect.stringMatching(/vitest\.mjs$/),
      'scripts/agent-isolation/run.mjs',
      expect.stringMatching(/bin[/\\]tsc$/),
      'scripts/test-renderer.mjs',
    ])
  })

  it('runs only unit tests even when integration environment flags are set', async () => {
    vi.stubEnv('SLIDEMIND_TIKA_INTEGRATION', '1')
    vi.stubEnv('SLIDEMIND_PANDOC_INTEGRATION', '1')
    vi.stubEnv('SLIDEMIND_WEB_LIVE_TEST', '1')
    process.argv.push('--unit')
    await import('./test.mjs')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0][1]).toEqual([
      expect.stringMatching(/vitest\.mjs$/),
      'run',
      '--exclude',
      '**/*integration.test.ts',
      '--exclude',
      '**/web-live.test.ts',
    ])
  })

  it('keeps packaged execution checks in an explicit test mode', async () => {
    process.argv.push('--packaged')
    await import('./test.mjs')
    expect(scripts()).toEqual([
      'scripts/tika-package/verify.mjs',
      'scripts/pandoc-package/verify.mjs',
      'scripts/agent-isolation/verify-package.mjs',
    ])
  })

  it('rejects unit mode combined with integration tests', async () => {
    process.argv.push('--unit', '--integration')
    await expect(import('./test.mjs')).rejects.toThrow('on their own')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('prepares runtimes before forced integration and builds before PDF tests', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    process.argv.push('--integration', '--live-web')
    await import('./test.mjs')
    expect(scripts().slice(0, 2)).toEqual([
      'scripts/tika-p0/prepare-runtime.mjs',
      'scripts/pandoc-package/prepare.mjs',
    ])
    expect(spawn.mock.calls[2][2].env).toMatchObject({
      SLIDEMIND_TIKA_INTEGRATION: '1',
      SLIDEMIND_PANDOC_INTEGRATION: '1',
      SLIDEMIND_WEB_LIVE_TEST: '1',
    })
    expect(scripts().slice(-2)).toEqual([
      expect.stringMatching(/electron-vite\.js$/),
      'scripts/pdf-p3/run-local.mjs',
    ])
  })

  it('rejects unsupported integration hosts before starting subprocesses', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    process.argv.push('--integration')
    await expect(import('./test.mjs')).rejects.toThrow('macOS or Windows')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stops on a failed suite', async () => {
    spawn.mockImplementationOnce(() => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('exit', 1))
      return child
    })
    await expect(import('./test.mjs')).rejects.toThrow('failed (1)')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown options rather than silently omitting tests', async () => {
    process.argv.push('--intergation')
    await expect(import('./test.mjs')).rejects.toThrow('Unknown test option')
    expect(spawn).not.toHaveBeenCalled()
  })
})
