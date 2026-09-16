import { publicWebUrl, WebError, type WebTransport } from './web-transport'

export interface WebSource {
  url: string
  title: string
  text: string
  kind: 'search_excerpt' | 'page'
  publishedDate?: string
  fetchedAt?: string
  contentHash?: string
  error?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseExaResponse(body: string): WebSource[] {
  const payloads =
    body.startsWith('data:') || body.includes('\ndata:')
      ? body
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .filter(Boolean)
      : [body]
  let payload: unknown
  for (const text of payloads) {
    let candidate: unknown
    try {
      candidate = JSON.parse(text)
    } catch {
      throw new WebError('搜索服务返回了无效数据')
    }
    if (record(candidate) && ('result' in candidate || 'error' in candidate)) {
      payload = candidate
      break
    }
  }
  if (
    !record(payload) ||
    payload.error ||
    !record(payload.result) ||
    payload.result.isError
  ) {
    throw new WebError('搜索服务返回错误或已达到公共接口限额')
  }
  const content = payload.result.content
  if (!Array.isArray(content)) throw new WebError('搜索服务结果格式无效')
  const text = content
    .filter(record)
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
  if (!text.trim()) throw new WebError('搜索服务未返回可解析内容')
  if (text.trim().startsWith('{')) {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new WebError('搜索服务结果 JSON 无效')
    }
    if (!record(data) || !Array.isArray(data.results))
      throw new WebError('搜索服务结果格式无效')
    return data.results.map((item: unknown) => {
      if (!record(item) || typeof item.url !== 'string')
        throw new WebError('搜索来源缺少有效 URL')
      return {
        url: publicWebUrl(item.url).href,
        title:
          typeof item.title === 'string' ? item.title.slice(0, 1000) : item.url,
        text: typeof item.text === 'string' ? item.text.slice(0, 20000) : '',
        kind: 'search_excerpt' as const,
        ...(typeof item.publishedDate === 'string'
          ? { publishedDate: item.publishedDate }
          : {}),
      }
    })
  }
  if (/no (?:search )?results (?:found|available)/i.test(text)) return []
  throw new WebError('搜索服务结果格式已变化，无法可靠提取来源')
}

export async function searchWeb(
  transport: WebTransport,
  query: string,
  numResults: number,
  signal: AbortSignal,
  filters: {
    domainFilter?: string[]
    recencyFilter?: 'day' | 'week' | 'month' | 'year'
  } = {},
): Promise<WebSource[]> {
  const domains = filters.domainFilter ?? []
  for (const domain of domains) {
    if (!/^-?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))
      throw new WebError('域名过滤必须是普通域名，排除域名前加 -')
  }
  const days = { day: 1, week: 7, month: 30, year: 365 }
  const startPublishedDate = filters.recencyFilter
    ? new Date(
        Date.now() - days[filters.recencyFilter] * 86400000,
      ).toISOString()
    : undefined
  const response = await transport(
    'https://mcp.exa.ai/mcp?tools=web_search_advanced_exa',
    signal,
    {
      maxBytes: 2 * 1024 * 1024,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'web_search_advanced_exa',
          arguments: {
            query,
            numResults,
            type: 'auto',
            textMaxCharacters: 10000,
            includeDomains: domains.filter((domain) => !domain.startsWith('-')),
            excludeDomains: domains
              .filter((domain) => domain.startsWith('-'))
              .map((domain) => domain.slice(1)),
            ...(startPublishedDate ? { startPublishedDate } : {}),
          },
        },
      }),
    },
  )
  return parseExaResponse(response.bytes.toString('utf8')).slice(0, numResults)
}
