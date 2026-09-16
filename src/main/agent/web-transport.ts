import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import {
  AntiSSRFError,
  AntiSSRFPolicy,
  PolicyConfigOptions,
} from '@microsoft/antissrf'

export class WebError extends Error {}

export interface WebResponse {
  bytes: Buffer
  contentType: string
  url: string
}

export type WebTransport = (
  url: string,
  signal: AbortSignal,
  options?: { body?: string; maxBytes?: number },
) => Promise<WebResponse>

export function publicWebUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WebError('网页地址无效')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new WebError('仅支持不含凭据的 HTTP(S) 地址')
  }
  return url
}

// AntiSSRF agents check the address used by the connection, including DNS results.
// Node requests do not inherit environment proxies or browser cookies.
export const requestWeb: WebTransport = async (
  value,
  sourceSignal,
  options = {},
) => {
  const policy = new AntiSSRFPolicy(PolicyConfigOptions.ExternalOnlyLatest)
  policy.addXFFHeader = false
  policy.allowPlainTextHttp = true
  const httpAgent = policy.getHttpAgent({ keepAlive: false, maxSockets: 2 })
  const httpsAgent = policy.getHttpsAgent({ keepAlive: false, maxSockets: 2 })
  const signal = AbortSignal.any([sourceSignal, AbortSignal.timeout(30_000)])
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024
  let url = publicWebUrl(value)
  try {
    for (let redirect = 0; redirect <= 5; redirect++) {
      signal.throwIfAborted()
      const response = await new Promise<import('node:http').IncomingMessage>(
        (resolve, reject) => {
          const secure = url.protocol === 'https:'
          const request = (secure ? httpsRequest : httpRequest)(
            url,
            {
              agent: secure ? httpsAgent : httpAgent,
              method: options.body === undefined ? 'GET' : 'POST',
              signal,
              headers: {
                'user-agent': 'SlideMind/0.1',
                'accept-encoding': 'identity',
                accept:
                  options.body === undefined
                    ? 'text/html, text/plain, application/pdf'
                    : 'application/json, text/event-stream',
                ...(options.body === undefined
                  ? {}
                  : { 'content-type': 'application/json' }),
              },
            },
            resolve,
          )
          request.once('error', reject)
          request.end(options.body)
        },
      )
      try {
        const status = response.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status)) {
          if (options.body !== undefined)
            throw new WebError('搜索服务重定向被拒绝')
          const location = response.headers.location
          if (!location || redirect === 5)
            throw new WebError('网页重定向无效或次数过多')
          url = publicWebUrl(new URL(location, url).href)
          continue
        }
        if (status < 200 || status >= 300)
          throw new WebError(`Web 请求失败（HTTP ${status}）`)
        if (
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        ) {
          throw new WebError('不支持压缩响应，请使用其他来源')
        }
        if (Number(response.headers['content-length']) > maxBytes)
          throw new WebError('响应超过大小限制')
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of response) {
          signal.throwIfAborted()
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.length
          if (size > maxBytes) throw new WebError('响应超过大小限制')
          chunks.push(bytes)
        }
        return {
          bytes: Buffer.concat(chunks),
          contentType: response.headers['content-type'] ?? '',
          url: url.href,
        }
      } finally {
        response.destroy()
      }
    }
    throw new WebError('网页重定向次数过多')
  } catch (error) {
    sourceSignal.throwIfAborted()
    if (error instanceof WebError) throw error
    if (
      error instanceof AntiSSRFError ||
      (error instanceof Error &&
        ('code' in error ||
          error.name === 'TimeoutError' ||
          error.name === 'AbortError'))
    ) {
      throw new WebError('Web 网络连接失败、超时或目标被安全策略拒绝')
    }
    throw error
  } finally {
    httpAgent.destroy()
    httpsAgent.destroy()
  }
}
