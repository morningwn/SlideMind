import type { DocumentExportFailureCode } from '../../shared/document-export'

export class DocumentExportError extends Error {
  constructor(
    readonly code: DocumentExportFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DocumentExportError'
  }
}

export function documentExportFailure(error: unknown): {
  status: 'failed'
  code: DocumentExportFailureCode
  message: string
} {
  if (error instanceof DocumentExportError) {
    return { status: 'failed', code: error.code, message: error.message }
  }
  return {
    status: 'failed',
    code: 'conversion_failed',
    message: 'Markdown 转换为 Word 失败',
  }
}
