export function createQuitHandler(options: {
  cleanup: (() => Promise<void>)[]
  onError: (error: unknown) => void
  quit: () => void
}): (event: { preventDefault: () => void }) => void {
  let complete = false
  let pending: Promise<void> | undefined

  return (event) => {
    if (complete) return
    event.preventDefault()
    if (pending) return

    // Electron does not wait for promises returned by will-quit listeners.
    pending = Promise.allSettled(
      options.cleanup.map((cleanup) => Promise.resolve().then(cleanup)),
    ).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') options.onError(result.reason)
      }
      complete = true
      options.quit()
    })
  }
}
