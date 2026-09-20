import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentReadError } from '../../shared/document'
import { TikaClient } from './tika-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

function response(body: string, init?: ResponseInit): Response {
  return new Response(body, init)
}

describe('TikaClient', () => {
  it.each([
    '普通高中教科书·语文选择性必修 上册(1).pdf',
    'café-课堂📖.pdf',
    "教师's (课堂)*资料.pdf",
  ])(
    'sends %s with valid ASCII headers and a recoverable Unicode name',
    async (file) => {
      const bytes = new Uint8Array([1, 2, 3])
      const requests: Request[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          // Use the real Fetch constructor, even when transport is mocked, so
          // non-ByteString headers fail here rather than silently passing tests.
          const request = new Request(input, init)
          requests.push(request)
          return request.url.endsWith('/detect')
            ? response('application/pdf')
            : response(JSON.stringify([{ 'tk:content': '课堂内容' }]))
        }),
      )

      const result = await new TikaClient().parse(
        'http://127.0.0.1:9998',
        bytes,
        file,
      )

      expect(result.entries[0]['tk:content']).toBe('课堂内容')
      expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
        '/detect',
        '/rmeta/text',
      ])
      for (const request of requests) {
        expect(request.method).toBe('PUT')
        expect(request.redirect).toBe('error')
        const disposition = request.headers.get('Content-Disposition')!
        expect(disposition).toMatch(/^[\u0020-\u007e]+$/)
        const encoded = disposition.split("filename*=UTF-8''")[1]
        expect(encoded).not.toMatch(/['()*]/)
        expect(decodeURIComponent(encoded)).toBe(file)
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes)
      }
    },
  )

  it('does not split a Unicode surrogate pair when limiting a header filename', async () => {
    const file = `${'a'.repeat(254)}📖.pdf`
    const headers: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        headers.push(request.headers.get('Content-Disposition')!)
        return request.url.endsWith('/detect')
          ? response('application/pdf')
          : response('[]')
      }),
    )

    await new TikaClient().parse(
      'http://127.0.0.1:9998',
      new Uint8Array([1]),
      file,
    )
    expect(headers).toHaveLength(2)
    expect(decodeURIComponent(headers[0].split("filename*=UTF-8''")[1])).toBe(
      `${'a'.repeat(254)}📖`,
    )
  })

  it('does not label invalid request construction as a runtime connection failure', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      new TikaClient().parse('not a URL', new Uint8Array([1]), 'sample.pdf'),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves the transport failure as the cause of a runtime error', async () => {
    const failure = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connection refused'), {
        code: 'ECONNREFUSED',
      }),
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    await expect(
      new TikaClient().parse(
        'http://127.0.0.1:9998',
        new Uint8Array([1]),
        'sample.pdf',
      ),
    ).rejects.toMatchObject({
      code: 'runtime_unavailable',
      cause: failure,
      message: '无法连接 Tika 运行时',
    })
  })

  it('detects the actual MIME type and parses bounded recursive metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) =>
        request.url.endsWith('/detect')
          ? response(
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            )
          : response(
              JSON.stringify([{ 'tk:content': 'hello', 'dc:title': 'sample' }]),
            ),
      ),
    )
    const result = await new TikaClient().parse(
      'http://127.0.0.1:9998',
      new Uint8Array([1, 2]),
      '测试.docx',
    )
    expect(result.mimeType).toContain('wordprocessingml')
    expect(result.entries[0]['tk:content']).toBe('hello')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects disguised files after content detection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('application/pdf')),
    )
    await expect(
      new TikaClient().parse(
        'http://127.0.0.1:9998',
        new Uint8Array([1]),
        'fake.docx',
      ),
    ).rejects.toMatchObject({ code: 'unsupported_format' })
  })

  it.each([
    [
      '数据.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    ['legacy.xls', 'application/vnd.ms-excel'],
    ['报告.pdf', 'application/pdf'],
  ])('accepts supported %s content', async (file, mimeType) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) =>
        request.url.endsWith('/detect')
          ? response(mimeType)
          : response(JSON.stringify([{ 'tk:content': 'extracted content' }])),
      ),
    )
    await expect(
      new TikaClient().parse(
        'http://127.0.0.1:9998',
        new Uint8Array([1, 2]),
        file,
      ),
    ).resolves.toMatchObject({ mimeType })
  })

  it('rejects a supported MIME type when it does not match the extension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('application/pdf')),
    )
    await expect(
      new TikaClient().parse(
        'http://127.0.0.1:9998',
        new Uint8Array([1]),
        'renamed.xlsx',
      ),
    ).rejects.toMatchObject({ code: 'unsupported_format' })
  })

  it('rejects an oversized response before parsing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) =>
        request.url.endsWith('/detect')
          ? response('application/msword')
          : response('x'.repeat(128)),
      ),
    )
    await expect(
      new TikaClient({ maxResponseBytes: 64 }).parse(
        'http://127.0.0.1:9998',
        new Uint8Array([1]),
        'large.doc',
      ),
    ).rejects.toBeInstanceOf(DocumentReadError)
  })
})
