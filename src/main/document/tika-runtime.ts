import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { DocumentReadError } from '../../shared/document'
import { getLogger } from '../logging/logger'

const logger = getLogger('tika-runtime')
const STDERR_LIMIT = 64 * 1024

export type TikaRuntimeState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'failed'

export interface TikaRuntimeOptions {
  configPath: string
  idleTimeoutMs?: number
  javaBinary: string
  missingRuntimeMessage?: string
  startupTimeoutMs?: number
  tikaJar: string
  tikaVersion: string
}

export interface TikaRuntimeLocationOptions {
  appPath: string
  isPackaged: boolean
  resourcesPath: string
}

interface PreparedRuntimeManifest {
  javaBinary: string
  platform?: string
  schemaVersion?: number
  tikaJar: string
  tikaVersion: string
}

export function resolveTikaRuntimeOptions(
  options: TikaRuntimeLocationOptions,
): TikaRuntimeOptions {
  const platform = `${process.platform}-${process.arch}`
  const runtimeRoot = options.isPackaged
    ? join(options.resourcesPath, 'tika-runtime', platform)
    : join(options.appPath, 'out/.tika-p0-runtime', platform)
  const preparedPath = join(runtimeRoot, 'prepared-runtime.json')
  const configPath = options.isPackaged
    ? join(runtimeRoot, 'tika-config.json')
    : join(options.appPath, 'scripts/tika-p0/tika-config.json')

  if (existsSync(preparedPath)) {
    let value: Partial<PreparedRuntimeManifest>
    try {
      value = JSON.parse(
        readFileSync(preparedPath, 'utf8'),
      ) as Partial<PreparedRuntimeManifest>
    } catch (error) {
      throw new DocumentReadError(
        'runtime_unavailable',
        'Tika 运行时清单无效',
        { cause: error },
      )
    }
    const resourcePath = (path: string): string =>
      isAbsolute(path) ? path : resolve(runtimeRoot, path)
    const pathsStayInRuntime = [value.javaBinary, value.tikaJar].every(
      (path) => {
        if (typeof path !== 'string' || isAbsolute(path))
          return !options.isPackaged
        return resourcePath(path).startsWith(`${resolve(runtimeRoot)}${sep}`)
      },
    )
    if (
      typeof value.javaBinary !== 'string' ||
      typeof value.tikaJar !== 'string' ||
      value.tikaVersion !== '4.0.0' ||
      (options.isPackaged &&
        (value.schemaVersion !== 1 ||
          value.platform !== platform ||
          !pathsStayInRuntime))
    ) {
      throw new DocumentReadError('runtime_unavailable', 'Tika 运行时清单无效')
    }
    return {
      configPath,
      javaBinary: resourcePath(value.javaBinary),
      missingRuntimeMessage: options.isPackaged
        ? '内置 Tika 运行时不完整，请重新安装应用'
        : 'Tika 开发运行时未准备，请先运行 pnpm tika:prepare',
      tikaJar: resourcePath(value.tikaJar),
      tikaVersion: value.tikaVersion,
    }
  }

  const javaBinary =
    process.platform === 'win32'
      ? join(runtimeRoot, 'runtime/java/bin/java.exe')
      : join(runtimeRoot, 'runtime/java/Contents/Home/bin/java')
  return {
    configPath,
    javaBinary,
    missingRuntimeMessage: options.isPackaged
      ? '内置 Tika 运行时不完整，请重新安装应用'
      : 'Tika 开发运行时未准备，请先运行 pnpm tika:prepare',
    tikaJar: join(runtimeRoot, 'runtime/tika/tika-server-standard-4.0.0.jar'),
    tikaVersion: '4.0.0',
  }
}

interface RunningProcess {
  baseUrl: string
  child: ChildProcess
  serverId: string
  workDirectory: string
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配 Tika 回环端口'))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

function minimalEnvironment(
  javaBinary: string,
  workDirectory: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    JAVA_HOME: dirname(dirname(javaBinary)),
    NO_PROXY: '127.0.0.1,localhost',
    PATH: dirname(javaBinary),
    TEMP: workDirectory,
    TMP: workDirectory,
    TMPDIR: workDirectory,
    no_proxy: '127.0.0.1,localhost',
  }
  for (const key of ['LANG', 'LC_ALL', 'SystemRoot', 'WINDIR']) {
    if (process.env[key]) environment[key] = process.env[key]
  }
  return environment
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        {
          stdio: 'ignore',
          windowsHide: true,
        },
      )
      killer.once('error', () => resolve())
      killer.once('exit', () => resolve())
    })
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(3_000),
  ])
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // The process exited between the check and signal.
    }
  }
}

export class TikaRuntime {
  private readonly idleTimeoutMs: number
  private readonly options: TikaRuntimeOptions
  private readonly startupTimeoutMs: number
  private activeRequests = 0
  private idleTimer?: NodeJS.Timeout
  private running?: RunningProcess
  private startingProcess?: Pick<RunningProcess, 'child' | 'workDirectory'>
  private startPromise?: Promise<string>
  private stopExpected = false
  private runtimeState: TikaRuntimeState = 'stopped'

  constructor(options: TikaRuntimeOptions) {
    this.options = options
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000
  }

  get state(): TikaRuntimeState {
    return this.runtimeState
  }

  async run<T>(operation: (baseUrl: string) => Promise<T>): Promise<T> {
    this.clearIdleTimer()
    const baseUrl = await this.start()
    this.activeRequests += 1
    try {
      return await operation(baseUrl)
    } finally {
      this.activeRequests -= 1
      this.scheduleIdleStop()
    }
  }

  async restart(): Promise<void> {
    await this.stop()
  }

  async stop(): Promise<void> {
    this.clearIdleTimer()
    const pendingStart = this.startPromise
    const running = this.running ?? this.startingProcess
    this.startPromise = undefined
    if (!running) {
      if (pendingStart) await pendingStart.catch(() => undefined)
      this.runtimeState = 'stopped'
      return
    }

    this.runtimeState = 'stopping'
    this.stopExpected = true
    this.running = undefined
    this.startingProcess = undefined
    await terminateProcessTree(running.child)
    if (pendingStart) await pendingStart.catch(() => undefined)
    await rm(running.workDirectory, { force: true, recursive: true }).catch(
      () => {
        logger.warn('runtime.temp_cleanup_failed')
      },
    )
    this.stopExpected = false
    this.runtimeState = 'stopped'
    logger.info('runtime.stopped')
  }

  private async start(): Promise<string> {
    if (this.runtimeState === 'ready' && this.running)
      return this.running.baseUrl
    if (this.startPromise) return this.startPromise
    this.startPromise = this.spawnRuntime()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = undefined
    }
  }

  private async spawnRuntime(): Promise<string> {
    this.runtimeState = 'starting'
    const startedAt = Date.now()
    const missingResources = [
      ['config', this.options.configPath],
      ['java', this.options.javaBinary],
      ['tika', this.options.tikaJar],
    ].filter(([, path]) => !existsSync(path))
    if (missingResources.length > 0) {
      this.runtimeState = 'failed'
      logger.error('runtime.resources_missing', {
        context: {
          resources: missingResources.map(([name]) => name).join(','),
        },
      })
      throw new DocumentReadError(
        'runtime_unavailable',
        this.options.missingRuntimeMessage ?? 'Tika 运行时文件缺失',
      )
    }
    const workDirectory = await mkdtemp(join(tmpdir(), 'slidemind-tika-'))
    const port = await reservePort()
    const serverId = `slidemind-${randomUUID()}`
    const baseUrl = `http://127.0.0.1:${port}`
    let stderr = ''
    const child = spawn(
      this.options.javaBinary,
      [
        '-Xmx256m',
        `-Djava.io.tmpdir=${workDirectory}`,
        '-jar',
        this.options.tikaJar,
        '-c',
        this.options.configPath,
        '-h',
        '127.0.0.1',
        '-p',
        String(port),
        '-i',
        serverId,
      ],
      {
        cwd: dirname(this.options.tikaJar),
        detached: process.platform !== 'win32',
        env: minimalEnvironment(this.options.javaBinary, workDirectory),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    )
    this.startingProcess = { child, workDirectory }
    let spawnError: Error | undefined
    child.once('error', (error) => {
      spawnError = error
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (value: string) => {
      if (stderr.length < STDERR_LIMIT)
        stderr += value.slice(0, STDERR_LIMIT - stderr.length)
    })
    child.once('exit', (code) => {
      if (!this.stopExpected && this.running?.child === child) {
        this.running = undefined
        this.runtimeState = 'failed'
        void rm(workDirectory, { force: true, recursive: true }).catch(
          () => undefined,
        )
        logger.error('runtime.unexpected_exit', {
          context: { exitCode: code ?? -1 },
        })
      }
    })

    try {
      const deadline = Date.now() + this.startupTimeoutMs
      const identityText = `Started Apache Tika server ${serverId} at ${baseUrl}/`
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError
        if (child.exitCode !== null)
          throw new Error(`Tika exited with code ${child.exitCode}`)
        try {
          const response = await fetch(`${baseUrl}/version`, {
            redirect: 'error',
            signal: AbortSignal.timeout(500),
          })
          const version = response.ok ? await response.text() : ''
          if (
            version.includes(this.options.tikaVersion) &&
            stderr.includes(identityText)
          ) {
            this.running = { baseUrl, child, serverId, workDirectory }
            this.startingProcess = undefined
            this.runtimeState = 'ready'
            logger.info('runtime.started', {
              durationMs: Date.now() - startedAt,
              context: { tikaVersion: this.options.tikaVersion },
            })
            return baseUrl
          }
        } catch {
          // The fixed local endpoint is not ready yet.
        }
        await delay(100)
      }
      throw new Error('Tika startup timed out')
    } catch (error) {
      if (!this.stopExpected) this.runtimeState = 'failed'
      this.startingProcess = undefined
      this.stopExpected = true
      await terminateProcessTree(child)
      await rm(workDirectory, { force: true, recursive: true }).catch(
        () => undefined,
      )
      this.stopExpected = false
      logger.error('runtime.start_failed', {
        durationMs: Date.now() - startedAt,
        error,
      })
      throw new DocumentReadError(
        'runtime_unavailable',
        'Tika 运行时启动失败',
        { cause: error },
      )
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private scheduleIdleStop(): void {
    if (this.activeRequests !== 0 || this.runtimeState !== 'ready') return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => void this.stop(), this.idleTimeoutMs)
    this.idleTimer.unref()
  }
}
