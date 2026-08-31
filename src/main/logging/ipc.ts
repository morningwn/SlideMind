import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import type { DiagnosticExportResult } from '../../shared/desktop'
import {
  diagnosticBundleFileName,
  writeDiagnosticBundle,
  type DiagnosticEnvironment
} from './diagnostics'
import { clearApplicationLogs, getLogger } from './logger'
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

export interface LoggingIpcOptions {
  crashDumpsDirectory: string
  downloadsDirectory: string
  environment: DiagnosticEnvironment
  logsDirectory: string
}

function trustedWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw new Error('拒绝来自未知窗口的请求')
  return window
}

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

export function registerLoggingIpc(options: LoggingIpcOptions): void {
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

  ipcMain.handle('logging:open-directory', async (event): Promise<void> => {
    trustedWindow(event)
    try {
      await mkdir(options.logsDirectory, { recursive: true, mode: 0o700 })
      const errorMessage = await shell.openPath(options.logsDirectory)
      if (errorMessage) throw new Error(errorMessage)
      logger.info('logs.directory_opened')
    } catch (error) {
      logger.error('logs.directory_open_failed', { error })
      throw new Error('无法打开日志目录')
    }
  })

  ipcMain.handle('logging:open-crash-directory', async (event): Promise<void> => {
    trustedWindow(event)
    try {
      await mkdir(options.crashDumpsDirectory, { recursive: true, mode: 0o700 })
      const errorMessage = await shell.openPath(options.crashDumpsDirectory)
      if (errorMessage) throw new Error(errorMessage)
      logger.info('crash_reports.directory_opened')
    } catch (error) {
      logger.error('crash_reports.directory_open_failed', { error })
      throw new Error('无法打开崩溃报告目录')
    }
  })

  ipcMain.handle(
    'logging:export-diagnostics',
    async (event): Promise<DiagnosticExportResult> => {
      const window = trustedWindow(event)
      const result = await dialog.showSaveDialog(window, {
        title: '导出 SlideMind 诊断包',
        buttonLabel: '导出诊断包',
        defaultPath: join(options.downloadsDirectory, diagnosticBundleFileName()),
        filters: [{ name: '压缩诊断数据', extensions: ['gz'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (result.canceled || !result.filePath) return { canceled: true }

      logger.info('diagnostics.export_started')
      try {
        await writeDiagnosticBundle(
          result.filePath,
          options.logsDirectory,
          options.environment
        )
        logger.info('diagnostics.export_completed')
        return { canceled: false, filePath: result.filePath }
      } catch (error) {
        logger.error('diagnostics.export_failed', { error })
        throw new Error('无法导出诊断包')
      }
    }
  )

  ipcMain.handle('logging:clear', async (event): Promise<boolean> => {
    const window = trustedWindow(event)
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: '清除本地日志？',
      message: '清除后，现有日志将无法用于排查之前的问题。',
      buttons: ['清除日志', '取消'],
      defaultId: 1,
      cancelId: 1
    })
    if (result.response !== 0) return false

    try {
      clearApplicationLogs()
      logger.info('logs.cleared')
      return true
    } catch (error) {
      logger.error('logs.clear_failed', { error })
      throw new Error('无法清除日志')
    }
  })
}
