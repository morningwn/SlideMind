import { createRequire } from 'node:module'
import { WebError } from './web-transport'

// Match the extraction worker's CommonJS entry; linkedom 0.16's ESM entry
// contains extensionless imports that Node cannot resolve.
const { parseHTML } = createRequire(import.meta.url)(
  'linkedom',
) as typeof import('linkedom')

function declaredCharset(contentType: string): string | undefined {
  return contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
}

export function decodeWebText(bytes: Buffer, contentType: string): string {
  let charset: string | undefined
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    charset = 'utf-8'
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) charset = 'utf-16le'
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) charset = 'utf-16be'
  else charset = declaredCharset(contentType)

  if (!charset && /^text\/html(?:;|$)/i.test(contentType)) {
    // HTML declarations are ASCII-compatible and must occur within the first
    // 1024 bytes. Parsing this bounded prefix ignores declarations in comments.
    const { document } = parseHTML(bytes.subarray(0, 1024).toString('latin1'))
    for (const meta of document.querySelectorAll('meta')) {
      const attributes = new Map(
        Array.from(meta.attributes, (attribute) => [
          attribute.name.toLowerCase(),
          attribute.value,
        ]),
      )
      charset = attributes.get('charset')?.trim() || undefined
      if (
        !charset &&
        attributes.get('http-equiv')?.trim().toLowerCase() === 'content-type'
      )
        charset = declaredCharset(attributes.get('content') ?? '')
      if (charset) break
    }
  }

  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset ?? 'utf-8', { fatal: true })
  } catch (error) {
    if (error instanceof RangeError) throw new WebError('网页字符编码不受支持')
    throw error
  }
  try {
    return decoder.decode(bytes)
  } catch (error) {
    if (error instanceof TypeError)
      throw new WebError('网页字符编码与内容不匹配，无法可靠读取正文')
    throw error
  }
}
