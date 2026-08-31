import { lstat, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { crashReporter } from 'electron'
import { getLogger } from './logger'

const MAX_SCAN_DEPTH = 4
const MAX_SCAN_ENTRIES = 2_000
const logger = getLogger('crash-reporter')

export interface LocalCrashReportSummary {
  count: number
  latestModifiedAt?: string
  truncated: boolean
}

interface MutableCrashReportSummary {
  count: number
  latestModifiedAt?: Date
  scannedEntries: number
  truncated: boolean
}

interface CrashReporterAdapter {
  getUploadToServer(): boolean
  setUploadToServer(uploadToServer: boolean): void
  start(options: Electron.CrashReporterStartOptions): void
}

async function scanDirectory(
  directory: string,
  depth: number,
  summary: MutableCrashReportSummary
): Promise<void> {
  if (depth > MAX_SCAN_DEPTH || summary.truncated) return

  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    summary.scannedEntries += 1
    if (summary.scannedEntries > MAX_SCAN_ENTRIES) {
      summary.truncated = true
      return
    }
    if (entry.isSymbolicLink()) continue

    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await scanDirectory(path, depth + 1, summary)
      continue
    }
    if (!entry.isFile() || extname(entry.name).toLocaleLowerCase() !== '.dmp') continue

    try {
      const stats = await lstat(path)
      if (!stats.isFile()) continue
      summary.count += 1
      if (!summary.latestModifiedAt || stats.mtime > summary.latestModifiedAt) {
        summary.latestModifiedAt = stats.mtime
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

export async function inspectLocalCrashReports(
  crashesDirectory: string
): Promise<LocalCrashReportSummary> {
  const summary: MutableCrashReportSummary = {
    count: 0,
    scannedEntries: 0,
    truncated: false
  }
  await scanDirectory(crashesDirectory, 0, summary)
  return {
    count: summary.count,
    truncated: summary.truncated,
    ...(summary.latestModifiedAt
      ? { latestModifiedAt: summary.latestModifiedAt.toISOString() }
      : {})
  }
}

export function initializeLocalCrashReporting(
  productName: string,
  reporter: CrashReporterAdapter = crashReporter
): void {
  try {
    reporter.start({
      productName,
      uploadToServer: false
    })
    if (reporter.getUploadToServer()) reporter.setUploadToServer(false)
    logger.info('crash_reporting.started', {
      context: { uploadToServer: reporter.getUploadToServer() }
    })
  } catch (error) {
    logger.error('crash_reporting.start_failed', { error })
  }
}

export async function reportExistingCrashReports(crashesDirectory: string): Promise<void> {
  try {
    const summary = await inspectLocalCrashReports(crashesDirectory)
    if (summary.count === 0) return
    logger.warn('crash_reports.available', {
      context: {
        count: summary.count,
        latestModifiedAt: summary.latestModifiedAt ?? null,
        truncated: summary.truncated
      }
    })
  } catch (error) {
    logger.warn('crash_reports.scan_failed', { error })
  }
}
