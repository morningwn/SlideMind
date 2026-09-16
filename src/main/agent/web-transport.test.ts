import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  responses: [] as Array<{
    status: number
    headers?: Record<string, string>
    chunks?: Buffer[]
  }>,
  urls: [] as string[],
}))
vi.mock('node:http', async (original) => {
  const actual = await original<typeof import('node:http')>()
  return { ...actual, request: fakeRequest }
})
vi.mock('node:https', async (original) => {
  const actual = await original<typeof import('node:https')>()
  return { ...actual, request: fakeRequest }
})
function fakeRequest(
  url: URL,
  _options: unknown,
  callback: (response: unknown) => void,
) {
  state.urls.push(url.href)
  const next = state.responses.shift()
  if (!next) throw new Error('Unexpected request')
  const request = new EventEmitter() as EventEmitter & { end: () => void }
  request.end = () => {
    const stream = Readable.from(next.chunks ?? [Buffer.from('body')])
    Object.assign(stream, {
      statusCode: next.status,
      headers: next.headers ?? {},
    })
    queueMicrotask(() => callback(stream))
  }
  return request
}
import { requestWeb } from './web-transport'
beforeEach(() => {
  state.responses.length = 0
  state.urls.length = 0
})
describe('bounded web transport', () => {
  it('follows relative redirects and returns the final URL', async () => {
    state.responses.push(
      { status: 302, headers: { location: '/final' } },
      { status: 200 },
    )
    expect(
      (
        await requestWeb(
          'https://example.com/start',
          new AbortController().signal,
        )
      ).url,
    ).toBe('https://example.com/final')
    expect(state.urls).toHaveLength(2)
  })
  it('does not forward search POST bodies to redirects', async () => {
    state.responses.push({
      status: 307,
      headers: { location: 'https://other.example.com' },
    })
    await expect(
      requestWeb('https://example.com', new AbortController().signal, {
        body: '{}',
      }),
    ).rejects.toThrow('重定向被拒绝')
    expect(state.urls).toHaveLength(1)
  })
  it('rejects redirect loops, unsupported targets and oversized/chunked/compressed responses', async () => {
    state.responses.push(
      ...Array.from({ length: 6 }, () => ({
        status: 302,
        headers: { location: '/loop' },
      })),
    )
    await expect(
      requestWeb('https://example.com', new AbortController().signal),
    ).rejects.toThrow('次数过多')
    state.responses.push({
      status: 302,
      headers: { location: 'file:///tmp/a' },
    })
    await expect(
      requestWeb('https://example.com', new AbortController().signal),
    ).rejects.toThrow('HTTP(S)')
    state.responses.push({
      status: 200,
      chunks: [Buffer.alloc(4), Buffer.alloc(4)],
    })
    await expect(
      requestWeb('https://example.com', new AbortController().signal, {
        maxBytes: 5,
      }),
    ).rejects.toThrow('大小限制')
    state.responses.push({ status: 200, headers: { 'content-length': '20' } })
    await expect(
      requestWeb('https://example.com', new AbortController().signal, {
        maxBytes: 5,
      }),
    ).rejects.toThrow('大小限制')
    state.responses.push({
      status: 200,
      headers: { 'content-encoding': 'gzip' },
    })
    await expect(
      requestWeb('https://example.com', new AbortController().signal),
    ).rejects.toThrow('压缩响应')
  })
  it('returns bounded status errors without echoing a sensitive response', async () => {
    state.responses.push({
      status: 429,
      chunks: [Buffer.from('secret provider response')],
    })
    await expect(
      requestWeb('https://example.com', new AbortController().signal),
    ).rejects.toThrow('HTTP 429')
  })
})
