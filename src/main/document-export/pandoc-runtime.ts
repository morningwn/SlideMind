import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DocumentExportError } from './errors'

const DEFAULT_TIMEOUT_MS = 60_000
const STDERR_LIMIT = 64 * 1024
const AST_LIMIT = 64 * 1024 * 1024
const HEAP_LIMIT_ARGUMENTS = ['+RTS', '-M512m', '-RTS'] as const

export interface PandocRuntimeOptions {
  binaryPath: string
  referencePath: string
  timeoutMs?: number
}

export interface PandocRuntimeLocationOptions {
  appPath: string
  isPackaged: boolean
  resourcesPath: string
}

export function resolvePandocRuntimeOptions(
  options: PandocRuntimeLocationOptions,
): PandocRuntimeOptions {
  const platform = `${process.platform}-${process.arch}`
  const binaryName = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'
  return options.isPackaged
    ? {
        binaryPath: join(
          options.resourcesPath,
          'pandoc-runtime',
          platform,
          'runtime',
          binaryName,
        ),
        referencePath: join(
          options.resourcesPath,
          'document-export',
          'reference.docx',
        ),
      }
    : {
        binaryPath: join(
          options.appPath,
          'out/.pandoc-p0-runtime',
          platform,
          'runtime',
          binaryName,
        ),
        referencePath: join(
          options.appPath,
          'assets/document-export/reference.docx',
        ),
      }
}

interface RunningProcess {
  child: ChildProcess
  operationId: string
}

interface RunOptions {
  arguments: string[]
  input: string
  operationId: string
  outputLimit: number
  signal?: AbortSignal
  workDirectory: string
}

function minimalEnvironment(
  binaryPath: string,
  workDirectory: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PANDOC_DATA_DIR: workDirectory,
    PATH: dirname(binaryPath),
    TEMP: workDirectory,
    TMP: workDirectory,
    TMPDIR: workDirectory,
  }
  for (const key of ['LANG', 'LC_ALL', 'SystemRoot', 'WINDIR']) {
    if (process.env[key]) environment[key] = process.env[key]
  }
  return environment
}

function terminate(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.killed) return
  if (process.platform === 'win32') {
    child.kill('SIGKILL')
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

export class PandocRuntime {
  private readonly running = new Map<string, RunningProcess>()
  private readonly timeoutMs: number

  constructor(readonly options: PandocRuntimeOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async parseMarkdown(
    markdown: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const workDirectory = await mkdtemp(join(tmpdir(), 'slidemind-pandoc-'))
    try {
      const output = await this.run({
        arguments: [
          '--sandbox',
          '--from=gfm',
          '--to=json',
          ...HEAP_LIMIT_ARGUMENTS,
        ],
        input: markdown,
        operationId,
        outputLimit: AST_LIMIT,
        signal,
        workDirectory,
      })
      try {
        return JSON.parse(output) as unknown
      } catch (error) {
        throw new DocumentExportError(
          'conversion_failed',
          'Pandoc 返回了无效的文档结构',
          {
            cause: error,
          },
        )
      }
    } finally {
      await rm(workDirectory, { recursive: true, force: true })
    }
  }

  async writeDocx(
    document: unknown,
    outputPath: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const workDirectory = await mkdtemp(join(tmpdir(), 'slidemind-pandoc-'))
    try {
      await this.run({
        arguments: [
          '--sandbox',
          '--from=json',
          '--to=docx',
          `--reference-doc=${this.options.referencePath}`,
          '--output',
          outputPath,
          ...HEAP_LIMIT_ARGUMENTS,
        ],
        input: JSON.stringify(document),
        operationId,
        outputLimit: 0,
        signal,
        workDirectory,
      })
    } finally {
      await rm(workDirectory, { recursive: true, force: true })
    }
  }

  cancel(operationId: string): void {
    const running = this.running.get(operationId)
    if (running) terminate(running.child)
  }

  async close(): Promise<void> {
    for (const running of this.running.values()) terminate(running.child)
    await Promise.all(
      [...this.running.values()].map(({ child }) =>
        child.exitCode === null
          ? new Promise<void>((resolve) => child.once('exit', () => resolve()))
          : Promise.resolve(),
      ),
    )
  }

  private run(options: RunOptions): Promise<string> {
    if (
      !existsSync(this.options.binaryPath) ||
      !existsSync(this.options.referencePath)
    ) {
      throw new DocumentExportError(
        'runtime_unavailable',
        'Word 导出运行时不可用',
      )
    }
    if (options.signal?.aborted) {
      throw new DocumentExportError('conversion_failed', 'Word 导出已取消')
    }

    return new Promise((resolve, reject) => {
      let settled = false
      let stderr = Buffer.alloc(0)
      let stdout = Buffer.alloc(0)
      let timedOut = false
      let outputExceeded = false
      const child = spawn(this.options.binaryPath, options.arguments, {
        cwd: options.workDirectory,
        detached: process.platform !== 'win32',
        env: minimalEnvironment(this.options.binaryPath, options.workDirectory),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.running.set(options.operationId, {
        child,
        operationId: options.operationId,
      })

      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        options.signal?.removeEventListener('abort', abort)
        if (this.running.get(options.operationId)?.child === child) {
          this.running.delete(options.operationId)
        }
        if (error) reject(error)
        else resolve(stdout.toString('utf8'))
      }
      const abort = (): void => terminate(child)
      const timeout = setTimeout(() => {
        timedOut = true
        terminate(child)
      }, this.timeoutMs)
      options.signal?.addEventListener('abort', abort, { once: true })

      child.stdout?.on('data', (chunk: Buffer) => {
        if (options.outputLimit === 0) return
        if (stdout.byteLength + chunk.byteLength > options.outputLimit) {
          outputExceeded = true
          terminate(child)
          return
        }
        stdout = Buffer.concat([stdout, chunk])
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.byteLength < STDERR_LIMIT) {
          stderr = Buffer.concat([
            stderr,
            chunk.subarray(0, STDERR_LIMIT - stderr.byteLength),
          ])
        }
      })
      child.once('error', (error) =>
        finish(
          new DocumentExportError(
            'runtime_unavailable',
            '无法启动 Word 导出运行时',
            {
              cause: error,
            },
          ),
        ),
      )
      child.once('exit', (code) => {
        if (timedOut) {
          finish(new DocumentExportError('timed_out', 'Word 导出超时'))
        } else if (options.signal?.aborted) {
          finish(
            new DocumentExportError('conversion_failed', 'Word 导出已取消'),
          )
        } else if (outputExceeded) {
          finish(
            new DocumentExportError(
              'conversion_failed',
              'Pandoc 文档结构超过 64 MiB',
            ),
          )
        } else if (code !== 0) {
          finish(
            new DocumentExportError('conversion_failed', 'Pandoc 转换失败'),
          )
        } else {
          finish()
        }
      })
      child.stdin?.once('error', () => undefined)
      child.stdin?.end(options.input, 'utf8')
    })
  }
}
