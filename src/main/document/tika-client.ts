import { basename } from 'node:path'
import { DocumentReadError } from '../../shared/document'

const DEFAULT_RESPONSE_BYTES = 16 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 90_000
const MAX_EXTRACTED_CHARS = 2_000_000
const ALLOWED_MIME_TYPES_BY_EXTENSION: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  '.doc': new Set(['application/msword']),
  '.docx': new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  '.pdf': new Set(['application/pdf']),
  '.xls': new Set(['application/vnd.ms-excel']),
  '.xlsx': new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
}

export interface TikaParseResult {
  entries: Record<string, unknown>[]
  mimeType: string
}

export interface TikaClientOptions {
  maxResponseBytes?: number
  timeoutMs?: number
}

function contentDisposition(file: string): string {
  const name =
    basename(file)
      .replace(/[\r\n"\\]/g, '_')
      .slice(0, 255) || 'document'
  return `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function allowedMimeTypes(file: string): ReadonlySet<string> | undefined {
  const normalized = file.toLocaleLowerCase()
  const extension = Object.keys(ALLOWED_MIME_TYPES_BY_EXTENSION).find(
    (candidate) => normalized.endsWith(candidate),
  )
  return extension ? ALLOWED_MIME_TYPES_BY_EXTENSION[extension] : undefined
}

function mapHttpError(status: number, body: string): DocumentReadError {
  const message = body.toLocaleLowerCase()
  if (message.includes('password') || message.includes('encrypted')) {
    return new DocumentReadError(
      'password_required',
      '文档需要密码，当前无法读取',
    )
  }
  if (status === 415)
    return new DocumentReadError('unsupported_format', '文件内容或格式不受支持')
  if (status === 408 || status === 504 || message.includes('timeout')) {
    return new DocumentReadError('timeout', 'Tika 文档解析超时')
  }
  if (
    status === 422 ||
    message.includes('corrupt') ||
    message.includes('invalid')
  ) {
    return new DocumentReadError('corrupt_document', '文档已损坏或无法解析')
  }
  return new DocumentReadError(
    'runtime_unavailable',
    `Tika 请求失败（HTTP ${status}）`,
  )
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body.cancel()
    throw new DocumentReadError('runtime_unavailable', 'Tika 响应超过大小限制')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new DocumentReadError(
        'runtime_unavailable',
        'Tika 响应超过大小限制',
      )
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export class TikaClient {
  private readonly maxResponseBytes: number
  private readonly timeoutMs: number

  constructor(options: TikaClientOptions = {}) {
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_RESPONSE_BYTES
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async parse(
    baseUrl: string,
    bytes: Uint8Array,
    file: string,
    signal?: AbortSignal,
  ): Promise<TikaParseResult> {
    const mimeType = (
      await this.request(`${baseUrl}/detect`, bytes, file, signal, 1024)
    )
      .trim()
      .split(';', 1)[0]
    if (!allowedMimeTypes(file)?.has(mimeType)) {
      throw new DocumentReadError(
        'unsupported_format',
        '文件扩展名与检测到的内容类型不匹配或不受支持',
      )
    }

    const body = await this.request(
      `${baseUrl}/rmeta/text`,
      bytes,
      file,
      signal,
      this.maxResponseBytes,
    )
    let value: unknown
    try {
      value = JSON.parse(body)
    } catch (error) {
      throw new DocumentReadError(
        'runtime_unavailable',
        'Tika 返回了无效 JSON',
        { cause: error },
      )
    }
    if (
      !Array.isArray(value) ||
      value.some((entry) => !entry || typeof entry !== 'object')
    ) {
      throw new DocumentReadError(
        'runtime_unavailable',
        'Tika 返回了无效解析结果',
      )
    }
    const entries = value as Record<string, unknown>[]
    const content = entries[0]?.['tk:content']
    if (typeof content === 'string' && content.length > MAX_EXTRACTED_CHARS) {
      throw new DocumentReadError(
        'runtime_unavailable',
        'Tika 正文超过配置的输出限制',
      )
    }
    return { entries, mimeType }
  }

  private async request(
    url: string,
    bytes: Uint8Array,
    file: string,
    signal: AbortSignal | undefined,
    maxBytes: number,
  ): Promise<string> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const requestBody = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(requestBody).set(bytes)
    let response: Response
    try {
      response = await fetch(url, {
        body: requestBody,
        headers: {
          'Content-Disposition': contentDisposition(file),
          'Content-Type': 'application/octet-stream',
        },
        method: 'PUT',
        redirect: 'error',
        signal: requestSignal,
      })
    } catch (error) {
      if (signal?.aborted)
        throw new DocumentReadError('cancelled', '文档读取已取消')
      if (timeout.aborted)
        throw new DocumentReadError('timeout', 'Tika 文档解析超时')
      throw new DocumentReadError(
        'runtime_unavailable',
        '无法连接 Tika 运行时',
        { cause: error },
      )
    }
    let responseBytes: Uint8Array
    try {
      responseBytes = await readBoundedBody(response, maxBytes)
    } catch (error) {
      if (error instanceof DocumentReadError) throw error
      if (signal?.aborted)
        throw new DocumentReadError('cancelled', '文档读取已取消')
      if (timeout.aborted)
        throw new DocumentReadError('timeout', 'Tika 文档解析超时')
      throw new DocumentReadError('runtime_unavailable', '读取 Tika 响应失败', {
        cause: error,
      })
    }
    const body = new TextDecoder('utf-8', { fatal: false }).decode(
      responseBytes,
    )
    if (!response.ok) throw mapHttpError(response.status, body.slice(0, 4096))
    return body
  }
}
