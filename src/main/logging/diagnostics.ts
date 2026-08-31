import { chmod, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzip } from 'node:zlib'
import {
  isApplicationLogFileName,
  sanitizeDiagnosticLog
} from './logger'

const MAX_BUNDLE_LOG_FILES = 5
const MAX_BUNDLE_LOG_BYTES = 30 * 1024 * 1024

export interface DiagnosticEnvironment {
  application: {
    isPackaged: boolean
    name: string
    version: string
  }
  runtime: {
    arch: string
    chrome: string
    electron: string
    node: string
    platform: string
  }
}

interface DiagnosticLogFile {
  content: string
  name: string
}

interface DiagnosticBundle {
  application: DiagnosticEnvironment['application']
  generatedAt: string
  logging: {
    fileCount: number
    files: DiagnosticLogFile[]
    format: 'jsonl'
  }
  runtime: DiagnosticEnvironment['runtime']
  schemaVersion: 1
}

function archiveIndex(name: string): number {
  if (name === 'slidemind.log') return 0
  const match = name.match(/^slidemind\.(\d+)\.log$/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

async function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gzip(input, { level: 9 }, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}

async function readDiagnosticLogs(logsDirectory: string): Promise<DiagnosticLogFile[]> {
  const names = (await readdir(logsDirectory))
    .filter(isApplicationLogFileName)
    .sort((left, right) => archiveIndex(left) - archiveIndex(right))
    .slice(0, MAX_BUNDLE_LOG_FILES)
  const logs: DiagnosticLogFile[] = []
  let totalBytes = 0

  for (const name of names) {
    const path = join(logsDirectory, name)
    const stats = await lstat(path)
    if (!stats.isFile() || totalBytes + stats.size > MAX_BUNDLE_LOG_BYTES) continue
    const content = await readFile(path, 'utf8')
    totalBytes += Buffer.byteLength(content)
    logs.push({ name, content: sanitizeDiagnosticLog(content) })
  }
  return logs
}

export function diagnosticBundleFileName(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `SlideMind-diagnostics-${timestamp}.json.gz`
}

export async function createDiagnosticBundle(
  logsDirectory: string,
  environment: DiagnosticEnvironment,
  now = new Date()
): Promise<Buffer> {
  const files = await readDiagnosticLogs(logsDirectory)
  const bundle: DiagnosticBundle = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    application: environment.application,
    runtime: environment.runtime,
    logging: {
      format: 'jsonl',
      fileCount: files.length,
      files
    }
  }
  return gzipBuffer(Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8'))
}

export async function writeDiagnosticBundle(
  outputPath: string,
  logsDirectory: string,
  environment: DiagnosticEnvironment
): Promise<void> {
  try {
    const existing = await lstat(outputPath)
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error('诊断包目标必须是普通文件')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const bundle = await createDiagnosticBundle(logsDirectory, environment)
  await writeFile(outputPath, bundle, { mode: 0o600 })
  await chmod(outputPath, 0o600).catch(() => undefined)
}
