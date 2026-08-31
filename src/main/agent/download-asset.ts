import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { get } from 'node:https'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { AntiSSRFPolicy, PolicyConfigOptions } from '@microsoft/antissrf'

const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const PROTECTED_PROJECT_DIRECTORIES = new Set([
  '.git',
  '.slidemind',
  'coverage',
  'node_modules',
  'out',
  'release-dist'
])

export type DownloadAssetKind = 'image' | 'text'

export interface AssetResponse {
  body: Readable
  headers: IncomingHttpHeaders
  statusCode: number
}

export type AssetOpener = (
  url: URL,
  signal: AbortSignal
) => Promise<AssetResponse>

export interface DownloadedAsset {
  bytes: number
  contentType?: string
  finalUrl: string
  path: string
  targetPath: string
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return candidatePath === projectPath || candidatePath.startsWith(`${projectPath}${sep}`)
}

function hasProtectedSegment(path: string): boolean {
  return path
    .split(sep)
    .some((segment) => PROTECTED_PROJECT_DIRECTORIES.has(segment.toLocaleLowerCase()))
}

function validatePathInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4096 ||
    value.includes('\0') ||
    isAbsolute(value)
  ) {
    throw new Error('下载路径无效')
  }
  return value
}

export async function resolveDownloadTarget(
  projectPathInput: string,
  pathInput: string
): Promise<{ path: string; projectPath: string; targetPath: string }> {
  const projectPath = await realpath(projectPathInput)
  const inputPath = validatePathInput(pathInput)
  const targetPath = resolve(projectPath, inputPath)
  if (!isInsideProject(projectPath, targetPath) || targetPath === projectPath) {
    throw new Error('下载路径超出项目范围')
  }

  const path = relative(projectPath, targetPath)
  if (hasProtectedSegment(path)) throw new Error('不能下载到受保护的项目目录')

  let currentPath = projectPath
  for (const segment of relative(projectPath, dirname(targetPath)).split(sep).filter(Boolean)) {
    currentPath = resolve(currentPath, segment)
    try {
      const stats = await lstat(currentPath)
      if (stats.isSymbolicLink()) throw new Error('不能通过符号链接目录下载')
      if (!stats.isDirectory()) throw new Error('下载位置不是文件夹')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }

  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink()) throw new Error('不能覆盖符号链接文件')
    if (!stats.isFile()) throw new Error('下载目标不是普通文件')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  return { path, projectPath, targetPath }
}

function validateUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('下载地址无效')
  }
  if (url.protocol !== 'https:') throw new Error('下载仅支持 HTTPS 地址')
  if (url.username || url.password) throw new Error('下载地址不能包含凭据')
  return url
}

function singleHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error(`响应包含多个 ${name} 头`)
    return value[0]
  }
  return value
}

function createSafeAssetOpener(): { close: () => void; open: AssetOpener } {
  const policy = new AntiSSRFPolicy(PolicyConfigOptions.ExternalOnlyLatest)
  policy.addXFFHeader = false
  policy.allowPlainTextHttp = false
  const agent = policy.getHttpsAgent({ keepAlive: false, maxSockets: 1 })

  return {
    close: () => agent.destroy(),
    open: (url, signal) => new Promise((resolveResponse, reject) => {
      const request = get(url, {
        agent,
        headers: {
          accept: 'image/*, text/*, application/json, application/xml;q=0.9, */*;q=0.1',
          'accept-encoding': 'identity',
          'user-agent': 'SlideMind/0.1'
        },
        signal
      }, (response) => {
        resolveResponse({
          body: response,
          headers: response.headers,
          statusCode: response.statusCode ?? 0
        })
      })
      request.once('error', reject)
    })
  }
}

function createDeadlineSignal(source?: AbortSignal): {
  cleanup: () => void
  didTimeOut: () => boolean
  signal: AbortSignal
} {
  const controller = new AbortController()
  let timedOut = false
  const relayAbort = (): void => controller.abort(source?.reason)
  if (source?.aborted) relayAbort()
  else source?.addEventListener('abort', relayAbort, { once: true })

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('下载超时'))
  }, DOWNLOAD_TIMEOUT_MS)
  timeout.unref()

  return {
    cleanup: () => {
      clearTimeout(timeout)
      source?.removeEventListener('abort', relayAbort)
    },
    didTimeOut: () => timedOut,
    signal: controller.signal
  }
}

function isRedirect(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode)
}

async function resolveResponse(
  initialUrl: URL,
  openAsset: AssetOpener,
  signal: AbortSignal
): Promise<{ response: AssetResponse; url: URL }> {
  let url = initialUrl
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await openAsset(url, signal)
    if (!isRedirect(response.statusCode)) return { response, url }

    const location = singleHeader(response.headers, 'location')
    response.body.destroy()
    if (!location) throw new Error('下载重定向缺少 Location')
    if (redirectCount === MAX_REDIRECTS) throw new Error('下载重定向次数过多')
    url = validateUrl(new URL(location, url).toString())
  }
  throw new Error('下载重定向次数过多')
}

function contentTypeFrom(headers: IncomingHttpHeaders): string | undefined {
  return singleHeader(headers, 'content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase()
}

function contentLengthFrom(headers: IncomingHttpHeaders): number | undefined {
  const value = singleHeader(headers, 'content-length')
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) throw new Error('响应 Content-Length 无效')
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new Error('响应 Content-Length 无效')
  return length
}

async function validateTextFile(path: string): Promise<void> {
  const content = await readFile(path)
  if (content.includes(0)) throw new Error('下载内容不是文本文件')
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    throw new Error('下载内容不是有效的 UTF-8 文本')
  }
}

function publicUrl(url: URL): string {
  const result = new URL(url)
  result.search = ''
  result.hash = ''
  return result.toString()
}

export async function downloadAsset(options: {
  kind: DownloadAssetKind
  openAsset?: AssetOpener
  path: string
  projectPath: string
  signal?: AbortSignal
  url: string
  validateImage?: (path: string) => Promise<void>
}): Promise<DownloadedAsset> {
  const initialTarget = await resolveDownloadTarget(options.projectPath, options.path)
  const initialUrl = validateUrl(options.url)
  const maxBytes = options.kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES
  const deadline = createDeadlineSignal(options.signal)
  const transport = options.openAsset ? undefined : createSafeAssetOpener()
  const openAsset = options.openAsset ?? transport!.open
  let temporaryPath: string | undefined

  try {
    await mkdir(dirname(initialTarget.targetPath), { recursive: true })
    const target = await resolveDownloadTarget(options.projectPath, options.path)
    if (target.targetPath !== initialTarget.targetPath) throw new Error('下载路径已发生变化')

    temporaryPath = resolve(
      dirname(target.targetPath),
      `.${basename(target.targetPath)}.${randomUUID()}.slidemind-tmp`
    )
    const { response, url } = await resolveResponse(initialUrl, openAsset, deadline.signal)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.body.destroy()
      throw new Error(`下载失败，HTTP 状态码：${response.statusCode}`)
    }
    const contentEncoding = singleHeader(response.headers, 'content-encoding')
    if (contentEncoding && contentEncoding.toLocaleLowerCase() !== 'identity') {
      response.body.destroy()
      throw new Error('下载响应使用了不支持的内容编码')
    }
    const declaredLength = contentLengthFrom(response.headers)
    if (declaredLength !== undefined && declaredLength > maxBytes) {
      response.body.destroy()
      throw new Error(`下载内容超过 ${maxBytes} 字节限制`)
    }

    const file = await open(temporaryPath, 'wx', 0o600)
    let bytes = 0
    try {
      for await (const chunk of response.body) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += data.length
        if (bytes > maxBytes) {
          response.body.destroy()
          throw new Error(`下载内容超过 ${maxBytes} 字节限制`)
        }
        let offset = 0
        while (offset < data.length) {
          const written = await file.write(data, offset)
          offset += written.bytesWritten
        }
      }
      await file.sync()
    } finally {
      await file.close()
    }

    if (declaredLength !== undefined && bytes !== declaredLength) {
      throw new Error('下载内容长度与响应头不一致')
    }
    if (options.kind === 'image') {
      if (!options.validateImage) throw new Error('图片校验器不可用')
      await options.validateImage(temporaryPath)
    } else {
      await validateTextFile(temporaryPath)
    }

    await rename(temporaryPath, target.targetPath)
    temporaryPath = undefined
    return {
      bytes,
      contentType: contentTypeFrom(response.headers),
      finalUrl: publicUrl(url),
      path: target.path,
      targetPath: target.targetPath
    }
  } catch (error) {
    if (deadline.didTimeOut()) throw new Error('下载超时')
    if (options.signal?.aborted) throw new Error('下载已取消')
    throw error
  } finally {
    deadline.cleanup()
    transport?.close()
    if (temporaryPath) {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }
}
