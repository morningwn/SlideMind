import type { App, BrowserWindow } from 'electron'
import { getLogger } from './logger'

const logger = getLogger('lifecycle')

export function installProcessErrorLogging(): void {
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logger.error('process.uncaught_exception', {
      error,
      context: { origin },
    })
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandled_rejection', { error: reason })
  })
}

export function installApplicationLifecycleLogging(app: App): void {
  app.on('child-process-gone', (_event, details) => {
    logger.error('app.child_process_gone', {
      context: {
        exitCode: details.exitCode,
        processType: details.type,
        reason: details.reason,
        serviceName: details.serviceName ?? null,
      },
    })
  })
}

export function installWindowLifecycleLogging(window: BrowserWindow): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('renderer.process_gone', {
      context: {
        exitCode: details.exitCode,
        reason: details.reason,
      },
      process: 'renderer',
    })
  })
  window.webContents.on('unresponsive', () => {
    logger.warn('renderer.unresponsive', { process: 'renderer' })
  })
  window.webContents.on('responsive', () => {
    logger.info('renderer.responsive', { process: 'renderer' })
  })
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      logger.error('renderer.load_failed', {
        context: { errorCode, isMainFrame },
        error: errorDescription,
        process: 'renderer',
      })
    },
  )
}
