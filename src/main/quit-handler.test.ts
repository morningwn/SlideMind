import { describe, expect, it, vi } from 'vitest'
import { createQuitHandler } from './quit-handler'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('createQuitHandler', () => {
  it('blocks repeated quit requests until every cleanup finishes, then allows quit', async () => {
    const first = deferred()
    const second = deferred()
    const cleanup = [vi.fn(() => first.promise), vi.fn(() => second.promise)]
    const quit = vi.fn()
    const onError = vi.fn()
    const handler = createQuitHandler({ cleanup, quit, onError })
    const preventDefault = vi.fn()

    handler({ preventDefault })
    handler({ preventDefault })
    await Promise.resolve()
    expect(preventDefault).toHaveBeenCalledTimes(2)
    for (const operation of cleanup) expect(operation).toHaveBeenCalledOnce()
    first.resolve()
    await Promise.resolve()
    expect(quit).not.toHaveBeenCalled()
    second.resolve()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
    handler({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
  })

  it('waits for remaining cleanup after a failure and reports the error before exiting', async () => {
    const remaining = deferred()
    const failure = new Error('flush failed')
    const quit = vi.fn()
    const onError = vi.fn()
    const handler = createQuitHandler({
      cleanup: [() => Promise.reject(failure), () => remaining.promise],
      quit,
      onError,
    })

    handler({ preventDefault: vi.fn() })
    await Promise.resolve()
    await Promise.resolve()
    expect(quit).not.toHaveBeenCalled()
    remaining.resolve()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
    expect(onError).toHaveBeenCalledWith(failure)
  })
})
