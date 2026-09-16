import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}))

import { PandocRuntime } from './pandoc-runtime'

interface FakeProcess extends EventEmitter {
  exitCode: number | null
  killed: boolean
  kill: ReturnType<typeof vi.fn>
  pid: number
  stderr: PassThrough
  stdin: PassThrough
  stdout: PassThrough
}

const roots: string[] = []

async function runtimeOptions(
  overrides: {
    astOutputLimitBytes?: number
    timeoutMs?: number
  } = {},
): Promise<ConstructorParameters<typeof PandocRuntime>[0]> {
  const root = await mkdtemp(join(tmpdir(), 'slidemind-pandoc-runtime-test-'))
  roots.push(root)
  const binaryPath = join(root, 'pandoc')
  const referencePath = join(root, 'reference.docx')
  await writeFile(binaryPath, 'fixture')
  await writeFile(referencePath, 'fixture')
  return { binaryPath, referencePath, ...overrides }
}

function fakeProcess(complete?: (child: FakeProcess) => void): FakeProcess {
  const child = new EventEmitter() as FakeProcess
  child.exitCode = null
  child.killed = false
  child.pid = 2_147_483_647
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn(() => {
    if (child.exitCode !== null) return true
    child.killed = true
    child.exitCode = 137
    queueMicrotask(() => child.emit('exit', child.exitCode))
    return true
  })
  if (complete) child.stdin.once('finish', () => complete(child))
  return child
}

function finish(
  child: FakeProcess,
  code: number,
  stdout = '',
  stderr = '',
): void {
  child.stdout.end(stdout)
  child.stderr.end(stderr)
  child.exitCode = code
  queueMicrotask(() => child.emit('exit', code))
}

describe('PandocRuntime child process handling', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    )
  })

  it('collects stdout without exposing stderr and rejects non-zero exits', async () => {
    const success = fakeProcess((child) =>
      finish(child, 0, '{"pandoc-api-version":[1,23],"meta":{},"blocks":[]}'),
    )
    const failure = fakeProcess((child) =>
      finish(child, 9, '', 'private source content'.repeat(10_000)),
    )
    spawnMock.mockReturnValueOnce(success).mockReturnValueOnce(failure)
    const runtime = new PandocRuntime(await runtimeOptions())

    await expect(
      runtime.parseMarkdown('# ok', 'success'),
    ).resolves.toMatchObject({
      blocks: [],
    })
    await expect(
      runtime.parseMarkdown('# fail', 'failure'),
    ).rejects.toMatchObject({
      code: 'conversion_failed',
      message: 'Pandoc 转换失败',
    })
  })

  it('terminates output overflow and timed-out processes', async () => {
    const overflow = fakeProcess((child) => {
      child.stdout.write('12345')
    })
    const hanging = fakeProcess()
    spawnMock.mockReturnValueOnce(overflow).mockReturnValueOnce(hanging)
    const runtime = new PandocRuntime(
      await runtimeOptions({ astOutputLimitBytes: 4, timeoutMs: 10 }),
    )

    await expect(
      runtime.parseMarkdown('# large', 'overflow'),
    ).rejects.toMatchObject({
      code: 'conversion_failed',
      message: 'Pandoc 文档结构超过 64 MiB',
    })
    await expect(
      runtime.parseMarkdown('# slow', 'timeout'),
    ).rejects.toMatchObject({
      code: 'timed_out',
    })
    expect(overflow.kill).toHaveBeenCalledOnce()
    expect(hanging.kill).toHaveBeenCalledOnce()
  })

  it('cancels one operation without terminating an isolated sibling', async () => {
    const first = fakeProcess()
    const second = fakeProcess()
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const runtime = new PandocRuntime(await runtimeOptions())
    const firstResult = runtime.parseMarkdown('# one', 'one')
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    const secondResult = runtime.parseMarkdown('# two', 'two')
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))

    runtime.cancel('one')
    finish(second, 0, '{"pandoc-api-version":[1,23],"meta":{},"blocks":[]}')

    await expect(firstResult).rejects.toMatchObject({
      code: 'conversion_failed',
    })
    await expect(secondResult).resolves.toMatchObject({ blocks: [] })
    expect(first.kill).toHaveBeenCalledOnce()
    expect(second.kill).not.toHaveBeenCalled()
  })

  it('terminates and awaits every process during shutdown', async () => {
    const first = fakeProcess()
    const second = fakeProcess()
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const runtime = new PandocRuntime(await runtimeOptions())
    const firstResult = runtime.parseMarkdown('# one', 'one')
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    const secondResult = runtime.parseMarkdown('# two', 'two')
    const results = [firstResult, secondResult]
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))

    await runtime.close()

    await Promise.allSettled(results)
    expect(first.kill).toHaveBeenCalledOnce()
    expect(second.kill).toHaveBeenCalledOnce()
  })
})
