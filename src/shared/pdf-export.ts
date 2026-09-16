export interface ExportMarkdownPdfInput {
  path: string
  content: string
}

export interface ExportPresentationPdfInput {
  path: string
}

export type PdfExportResult =
  | { status: 'canceled' }
  | { status: 'exported'; outputPath: string; pageCount: number }
  | { status: 'failed'; message: string }
