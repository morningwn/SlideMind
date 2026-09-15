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
  it('detects the actual MIME type and parses bounded recursive metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/detect')
      ? response('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      : response(JSON.stringify([{ 'tk:content': 'hello', 'dc:title': 'sample' }]))
    ))
    const result = await new TikaClient().parse(
      'http://127.0.0.1:9998',
      new Uint8Array([1, 2]),
      '测试.docx'
    )
    expect(result.mimeType).toContain('wordprocessingml')
    expect(result.entries[0]['tk:content']).toBe('hello')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects disguised files after content detection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('application/pdf')))
    await expect(new TikaClient().parse(
      'http://127.0.0.1:9998',
      new Uint8Array([1]),
      'fake.docx'
    )).rejects.toMatchObject({ code: 'unsupported_format' })
  })

  it('rejects an oversized response before parsing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/detect')
      ? response('application/msword')
      : response('x'.repeat(128))
    ))
    await expect(new TikaClient({ maxResponseBytes: 64 }).parse(
      'http://127.0.0.1:9998',
      new Uint8Array([1]),
      'large.doc'
    )).rejects.toBeInstanceOf(DocumentReadError)
  })
})
