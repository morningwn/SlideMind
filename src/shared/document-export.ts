export const DOCUMENT_EXPORT_FAILURE_CODES = [
  'busy',
  'conversion_failed',
  'input_too_large',
  'invalid_input',
  'output_changed',
  'output_failed',
  'resource_invalid',
  'resource_unsupported',
  'runtime_unavailable',
  'source_unavailable',
  'timed_out',
] as const

export type DocumentExportFailureCode =
  (typeof DOCUMENT_EXPORT_FAILURE_CODES)[number]

export const DOCUMENT_EXPORT_WARNING_CODES = [
  'mermaid_not_rendered',
  'unsupported_link_removed',
] as const

export type DocumentExportWarning =
  (typeof DOCUMENT_EXPORT_WARNING_CODES)[number]

export interface ExportMarkdownWordInput {
  path: string
  content: string
}

export type ExportMarkdownWordResult =
  | { status: 'canceled' }
  | {
      status: 'exported'
      outputPath: string
      warnings: DocumentExportWarning[]
    }
  | {
      status: 'failed'
      code: DocumentExportFailureCode
      message: string
    }

export interface DocumentExportApi {
  exportWord(
    projectHandle: string,
    input: ExportMarkdownWordInput,
  ): Promise<ExportMarkdownWordResult>
  exportPdf(
    projectHandle: string,
    input: import('./pdf-export').ExportMarkdownPdfInput,
  ): Promise<import('./pdf-export').PdfExportResult>
}
