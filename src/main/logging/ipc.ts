import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { getLogger } from './logger'
import { parseRendererDiagnosticEvent } from './renderer-event'

const MAX_EVENTS_PER_MINUTE = 60
const WINDOW_MS = 60_000
const logger = getLogger('renderer')

interface RateState {
  count: number
  startedAt: number
  warned: boolean
}

const rateStates = new Map<number, RateState>()

function isAllowed(sender: WebContents): boolean {
  const now = Date.now()
  let state = rateStates.get(sender.id)
  if (!state) sender.once('destroyed', () => rateStates.delete(sender.id))
  if (!state || now - state.startedAt >= WINDOW_MS) {
    state = { count: 0, startedAt: now, warned: false }
    rateStates.set(sender.id, state)
  }
  state.count += 1
  if (state.count <= MAX_EVENTS_PER_MINUTE) return true
  if (!state.warned) {
    state.warned = true
    logger.warn('renderer.log_rate_limited', { process: 'renderer' })
  }
  return false
}

export function registerLoggingIpc(): void {
  ipcMain.on('logging:renderer-event', (event, input: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || !isAllowed(event.sender)) return

    const diagnosticEvent = parseRendererDiagnosticEvent(input)
    if (!diagnosticEvent) {
      logger.warn('renderer.log_event_rejected', { process: 'renderer' })
      return
    }

    logger[diagnosticEvent.level](diagnosticEvent.event, {
      context: diagnosticEvent.context,
      error: diagnosticEvent.error,
      process: 'renderer'
    })
  })
}
