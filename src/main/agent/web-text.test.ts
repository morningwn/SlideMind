import { describe, expect, it } from 'vitest'
import { decodeWebText } from './web-text'
import { fetchWebSource } from './web-tools'

// GBK bytes for 中文; fixtures do not require an encoding dependency.
const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
const html = (head: string) =>
  Buffer.concat([
    Buffer.from(`<html><head>${head}</head><body><article><p>`),
    gbk,
    Buffer.from('</p></article></body></html>'),
  ])

describe('decodeWebText', () => {
  it.each([
    '<meta charset="gbk">',
    "<META CHARSET='GB2312'>",
    '<meta content="text/html; charset=gb2312" http-equiv="Content-Type">',
  ])('honors HTML encoding declaration %s', (meta) => {
    expect(decodeWebText(html(meta), 'text/html')).toContain('中文')
  })

  it('prioritizes BOM and HTTP charset over conflicting metadata', () => {
    expect(
      decodeWebText(html('<meta charset="utf-8">'), 'text/html; charset=gbk'),
    ).toContain('中文')
    expect(
      decodeWebText(Buffer.from('\uFEFF中文'), 'text/plain; charset=gbk'),
    ).toBe('中文')
    expect(
      decodeWebText(Buffer.from('\uFEFF中文', 'utf16le'), 'text/plain'),
    ).toBe('中文')
    expect(
      decodeWebText(
        Buffer.from([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]),
        'text/plain',
      ),
    ).toBe('中文')
  })

  it('ignores comment and script contents rather than treating them as declarations', () => {
    expect(() =>
      decodeWebText(html('<!-- <meta charset="gbk"> -->'), 'text/html'),
    ).toThrow('编码与内容不匹配')
    expect(() =>
      decodeWebText(html('<script>"<meta charset=gbk>"</script>'), 'text/html'),
    ).toThrow('编码与内容不匹配')
  })

  it('rejects invalid or unsupported encodings without emitting replacement characters', () => {
    expect(() => decodeWebText(gbk, 'text/plain')).toThrow('编码与内容不匹配')
    expect(() => decodeWebText(gbk, 'text/plain; charset=unknown')).toThrow(
      '编码不受支持',
    )
    expect(decodeWebText(Buffer.from('中文 UTF-8'), 'text/plain')).toBe(
      '中文 UTF-8',
    )
  })

  it('extracts readable Chinese from a legacy HTML page through fetchWebSource', async () => {
    const result = await fetchWebSource(
      'https://example.com/article',
      new AbortController().signal,
      {
        parsePdf: async () => '',
        transport: async (url) => ({
          url,
          contentType: 'text/html',
          bytes: html('<meta charset=gb2312>'),
        }),
      },
    )
    expect(result.text).toContain('中文')
    expect(result.text).not.toContain('\uFFFD')
  })
})
