import { createHash, randomUUID } from 'node:crypto'
import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import electronLog from 'electron-log/main'
import type { DiagnosticContextValue } from '../../shared/logging'
import { sanitizeContext, sanitizeError, sanitizeText, type SanitizedError } from './sanitize'

const LOG_FILE_NAME = 'slidemind.log'
const LOG_FILE_MAX_SIZE = 5 * 1024 * 1024
const LOG_ARCHIVE_COUNT = 4

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogProcess = 'main' | 'renderer' | 'worker'

export interface LogDetails {
  context?: Readonly<Record<string, DiagnosticContextValue>>
  durationMs?: number
  error?: unknown
  operationId?: string
  process?: LogProcess
}

interface LogRecord {
  component: string
  context?: Record<string, DiagnosticContextValue>
  durationMs?: number
  error?: SanitizedError
  event: string
  level: LogLevel
  operationId?: string
  process: LogProcess
  sessionId: string
  timestamp: string
}

export interface ComponentLogger {
  debug(event: string, details?: LogDetails): void
  error(event: string, details?: LogDetails): void
  info(event: string, details?: LogDetails): void
  warn(event: string, details?: LogDetails): void
}

export interface LoggingOptions {
  isPackaged: boolean
  logsDirectory: string
}

const sessionId = randomUUID()
const identifierSalt = randomUUID()
const sensitivePaths = [homedir()]
const sanitizeOptions = { sensitivePaths }
let sink: (record: LogRecord) => void = fallbackSink

function fallbackSink(record: LogRecord): void {
  if (record.level !== 'warn' && record.level !== 'error') return
  process.stderr.write(`${JSON.stringify(record)}\n`)
}

function archivePath(currentPath: string, index: number): string {
  const extension = extname(currentPath)
  const name = basename(currentPath, extension)
  return join(dirname(currentPath), `${name}.${index}${extension}`)
}

export function rotateLogFile(currentPath: string, archiveCount = LOG_ARCHIVE_COUNT): void {
  if (archiveCount < 1) {
    unlinkSync(currentPath)
    return
  }

  const oldestPath = archivePath(currentPath, archiveCount)
  if (existsSync(oldestPath)) unlinkSync(oldestPath)
  for (let index = archiveCount - 1; index >= 1; index -= 1) {
    const source = archivePath(currentPath, index)
    if (existsSync(source)) renameSync(source, archivePath(currentPath, index + 1))
  }
  renameSync(currentPath, archivePath(currentPath, 1))
}

function writeFailure(error: unknown): void {
  const failure = sanitizeError(error, sanitizeOptions)
  process.stderr.write(`[slidemind-logging] ${failure.name}: ${failure.message}\n`)
}

export function initializeApplicationLogging(options: LoggingOptions): void {
  electronLog.transports.file.level = options.isPackaged ? 'info' : 'debug'
  electronLog.transports.file.format = '{text}'
  electronLog.transports.file.maxSize = LOG_FILE_MAX_SIZE
  electronLog.transports.file.resolvePathFn = () => join(options.logsDirectory, LOG_FILE_NAME)
  electronLog.transports.file.writeOptions = {
    encoding: 'utf8',
    flag: 'a',
    mode: 0o600
  }
  electronLog.transports.file.archiveLogFn = (file) => {
    try {
      rotateLogFile(file.path)
    } catch (error) {
      writeFailure(error)
      file.clear()
    }
  }
  electronLog.transports.console.level = options.isPackaged ? 'warn' : 'debug'
  electronLog.transports.console.format = '{text}'
  electronLog.transports.ipc.level = false
  electronLog.transports.remote.level = false
  electronLog.transports.file.getFile().on('error', (error) => writeFailure(error))

  sink = (record) => {
    try {
      electronLog[record.level](JSON.stringify(record))
    } catch (error) {
      writeFailure(error)
    }
  }
}

export function diagnosticId(value: string): string {
  return createHash('sha256')
    .update(identifierSalt)
    .update('\0')
    .update(value)
    .digest('hex')
    .slice(0, 16)
}

export function registerSensitivePath(path: string): void {
  if (path && !sensitivePaths.includes(path)) sensitivePaths.push(path)
}

function recordLog(
  level: LogLevel,
  component: string,
  event: string,
  details: LogDetails = {}
): void {
  const context = sanitizeContext(details.context, sanitizeOptions)
  const durationMs = details.durationMs
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level,
    event: sanitizeText(event, sanitizeOptions, 200),
    component: sanitizeText(component, sanitizeOptions, 100),
    process: details.process ?? 'main',
    sessionId,
    ...(details.operationId
      ? { operationId: sanitizeText(details.operationId, sanitizeOptions, 100) }
      : {}),
    ...(typeof durationMs === 'number' && Number.isFinite(durationMs)
      ? { durationMs: Math.max(0, Math.round(durationMs)) }
      : {}),
    ...(details.error === undefined
      ? {}
      : { error: sanitizeError(details.error, sanitizeOptions) }),
    ...(context && Object.keys(context).length > 0 ? { context } : {})
  }
  sink(record)
}

export function getLogger(component: string): ComponentLogger {
  return {
    debug: (event, details) => recordLog('debug', component, event, details),
    error: (event, details) => recordLog('error', component, event, details),
    info: (event, details) => recordLog('info', component, event, details),
    warn: (event, details) => recordLog('warn', component, event, details)
  }
}
