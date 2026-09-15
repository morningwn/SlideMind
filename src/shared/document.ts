export const DOCUMENT_DEFAULT_MAX_CHARS = 20_000
export const DOCUMENT_MAX_CHARS = 50_000
export const DOCUMENT_MAX_FILE_BYTES = 30 * 1024 * 1024

export type DocumentExtractionStatus = 'complete' | 'partial' | 'empty'

export type DocumentReadErrorCode =
  | 'unsupported_format'
  | 'file_too_large'
  | 'file_changed'
  | 'cursor_expired'
  | 'invalid_cursor'
  | 'password_required'
  | 'corrupt_document'
  | 'runtime_unavailable'
  | 'timeout'
  | 'cancelled'
  | 'queue_full'

export interface DocumentReadInput {
  cursor?: string
  file: string
  maxChars?: number
}

export interface DocumentReadResult {
  content: string
  extractionStatus: DocumentExtractionStatus
  file: string
  metadata: Record<string, string[]>
  mimeType: string
  nextCursor?: string
  revision: string
  warnings: string[]
}

export class DocumentReadError extends Error {
  readonly code: DocumentReadErrorCode

  constructor(code: DocumentReadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DocumentReadError'
    this.code = code
  }
}

export function isDocumentPath(path: string): boolean {
  return /\.docx?$/i.test(path)
}

export function normalizeDocumentReadInput(value: unknown): DocumentReadInput {
  if (!value || typeof value !== 'object') {
    throw new DocumentReadError('invalid_cursor', '文档读取参数无效')
  }
  const input = value as Partial<DocumentReadInput>
  if (
    typeof input.file !== 'string' ||
    !input.file.trim() ||
    input.file.length > 4096 ||
    input.file.includes('\0')
  ) {
    throw new DocumentReadError('unsupported_format', '文档路径无效')
  }
  if (input.cursor !== undefined && (
    typeof input.cursor !== 'string' ||
    !input.cursor ||
    input.cursor.length > 2048
  )) {
    throw new DocumentReadError('invalid_cursor', '文档游标无效')
  }
  if (input.maxChars !== undefined && (
    !Number.isInteger(input.maxChars) ||
    input.maxChars < 1 ||
    input.maxChars > DOCUMENT_MAX_CHARS
  )) {
    throw new DocumentReadError(
      'invalid_cursor',
      `maxChars 必须是 1 到 ${DOCUMENT_MAX_CHARS} 之间的整数`
    )
  }
  return {
    file: input.file,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars })
  }
}
