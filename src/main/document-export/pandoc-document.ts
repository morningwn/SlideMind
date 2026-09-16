import type { DocumentExportWarning } from '../../shared/document-export'
import { DocumentExportError } from './errors'

interface PandocNode {
  c?: unknown
  t: string
}

export interface PreparedPandocDocument {
  document: unknown
  imageBytes: number
  warnings: DocumentExportWarning[]
}

export interface ResolvedPandocImage {
  bytes: Buffer
  mimeType: 'image/jpeg' | 'image/png'
}

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPandocNode(value: unknown): value is PandocNode {
  return isRecord(value) && typeof value.t === 'string'
}

function linkIsAllowed(target: string): boolean {
  if (target.startsWith('#')) return true
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(target).protocol)
  } catch {
    return false
  }
}

function targetFromNode(node: PandocNode): [string, string] {
  if (!Array.isArray(node.c) || !Array.isArray(node.c[2])) {
    throw new DocumentExportError('conversion_failed', 'Pandoc 图片结构无效')
  }
  const [target, title] = node.c[2]
  if (typeof target !== 'string' || typeof title !== 'string') {
    throw new DocumentExportError('conversion_failed', 'Pandoc 图片结构无效')
  }
  return [target, title]
}

function hasMermaidClass(node: PandocNode): boolean {
  if (
    node.t !== 'CodeBlock' ||
    !Array.isArray(node.c) ||
    !Array.isArray(node.c[0])
  )
    return false
  const classes = node.c[0][1]
  return Array.isArray(classes) && classes.includes('mermaid')
}

export async function preparePandocDocument(
  value: unknown,
  resolveImage: (target: string) => Promise<ResolvedPandocImage>,
  maximumImageBytes: number,
): Promise<PreparedPandocDocument> {
  if (
    !isRecord(value) ||
    !Array.isArray(value.blocks) ||
    !isRecord(value.meta)
  ) {
    throw new DocumentExportError('conversion_failed', 'Pandoc 文档结构无效')
  }

  const warnings = new Set<DocumentExportWarning>()
  let imageBytes = 0

  const visit = async (candidate: unknown, depth: number): Promise<unknown> => {
    if (depth > 256) {
      throw new DocumentExportError(
        'conversion_failed',
        'Markdown 文档嵌套层级过深',
      )
    }
    if (Array.isArray(candidate)) {
      const items: unknown[] = []
      for (const item of candidate) items.push(await visit(item, depth + 1))
      return items
    }
    if (!isRecord(candidate)) return candidate

    if (isPandocNode(candidate)) {
      if (candidate.t === 'RawBlock' || candidate.t === 'RawInline') {
        throw new DocumentExportError(
          'resource_unsupported',
          '首版 Word 导出不支持原始 HTML',
        )
      }
      if (hasMermaidClass(candidate)) warnings.add('mermaid_not_rendered')

      if (candidate.t === 'Image') {
        const [target, title] = targetFromNode(candidate)
        const image = await resolveImage(target)
        imageBytes += image.bytes.byteLength
        if (imageBytes > maximumImageBytes) {
          throw new DocumentExportError(
            'resource_invalid',
            '文档图片总量超过 25 MiB',
          )
        }
        const c = candidate.c as unknown[]
        return {
          ...candidate,
          c: [
            await visit(c[0], depth + 1),
            await visit(c[1], depth + 1),
            [
              `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
              title,
            ],
          ],
        }
      }

      if (candidate.t === 'Link') {
        if (!Array.isArray(candidate.c) || !Array.isArray(candidate.c[2])) {
          throw new DocumentExportError(
            'conversion_failed',
            'Pandoc 链接结构无效',
          )
        }
        const target = candidate.c[2][0]
        if (typeof target !== 'string') {
          throw new DocumentExportError(
            'conversion_failed',
            'Pandoc 链接结构无效',
          )
        }
        if (!linkIsAllowed(target)) {
          warnings.add('unsupported_link_removed')
          return {
            t: 'Span',
            c: [candidate.c[0], await visit(candidate.c[1], depth + 1)],
          }
        }
      }
    }

    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(candidate)) {
      result[key] = await visit(item, depth + 1)
    }
    return result
  }

  return {
    document: await visit({ ...value, meta: {} }, 0),
    imageBytes,
    warnings: [...warnings],
  }
}
