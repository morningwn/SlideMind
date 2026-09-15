import type { DocumentExtractionStatus } from '../../shared/document'

const MAX_METADATA_KEYS = 32
const MAX_METADATA_VALUES = 20
const MAX_METADATA_VALUE_CHARS = 2_000
const METADATA_KEYS = new Set([
  'Content-Type',
  'cp:revision',
  'dc:creator',
  'dc:description',
  'dc:subject',
  'dc:title',
  'dcterms:created',
  'dcterms:modified',
  'meta:author',
  'meta:character-count',
  'meta:page-count',
  'meta:word-count',
  'xmpTPg:NPages'
])

export interface NormalizedDocument {
  content: string
  extractionStatus: DocumentExtractionStatus
  metadata: Record<string, string[]>
  warnings: string[]
}

function metadataValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values
    .filter((entry): entry is string | number | boolean => (
      typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
    ))
    .map((entry) => String(entry).replaceAll('\0', '').trim().slice(0, MAX_METADATA_VALUE_CHARS))
    .filter(Boolean)
    .slice(0, MAX_METADATA_VALUES)
}

export function normalizeTikaDocument(entries: ReadonlyArray<Record<string, unknown>>): NormalizedDocument {
  const root = entries[0] ?? {}
  const content = (typeof root['tk:content'] === 'string' ? root['tk:content'] : '')
    .replaceAll('\0', '')
    .replace(/\r\n?/g, '\n')
    .trim()
  const metadata: Record<string, string[]> = {}
  for (const key of Object.keys(root).sort()) {
    if (!METADATA_KEYS.has(key) || Object.keys(metadata).length >= MAX_METADATA_KEYS) continue
    const values = metadataValues(root[key])
    if (values.length > 0) metadata[key] = values
  }

  const warnings = [
    '文档读取不保留页面视觉布局、准确页码或全部复杂表格结构。'
  ]
  const limitKeys = Object.keys(root).filter((key) => {
    const normalized = key.toLocaleLowerCase().replaceAll('_', '-').replaceAll(':', '-')
    return normalized.includes('write-limit-reached') || normalized.includes('output-limit-reached')
  })
  if (limitKeys.length > 0) warnings.push('Tika 已达到正文输出限制，返回内容不完整。')

  return {
    content,
    extractionStatus: content ? (limitKeys.length > 0 ? 'partial' : 'complete') : 'empty',
    metadata,
    warnings
  }
}

function safeEndOffset(content: string, start: number, end: number): number {
  let safeEnd = end
  if (
    safeEnd > start &&
    safeEnd < content.length &&
    /[\uD800-\uDBFF]/.test(content[safeEnd - 1]) &&
    /[\uDC00-\uDFFF]/.test(content[safeEnd])
  ) {
    safeEnd -= 1
  }
  return safeEnd
}

export function documentChunk(
  content: string,
  offset: number,
  maxChars: number,
  maxBytes = maxChars * 4
): { content: string; nextOffset?: number } {
  if (!Number.isInteger(offset) || offset < 0 || offset > content.length) {
    throw new Error('文档分段偏移无效')
  }
  let end = safeEndOffset(content, offset, Math.min(content.length, offset + maxChars))
  while (end > offset && Buffer.byteLength(content.slice(offset, end), 'utf8') > maxBytes) {
    end = safeEndOffset(content, offset, end - 1)
  }
  if (end < content.length) {
    const paragraphEnd = content.lastIndexOf('\n\n', end)
    if (paragraphEnd > offset + Math.floor((end - offset) / 2)) end = paragraphEnd + 2
  }
  if (end === offset && offset < content.length) {
    end = safeEndOffset(content, offset, Math.min(content.length, offset + 2))
  }
  return {
    content: content.slice(offset, end),
    ...(end < content.length ? { nextOffset: end } : {})
  }
}
