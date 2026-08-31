import type { RendererDiagnosticEvent } from './logging'

export type DesktopCloseResponse = 'keep-window-open' | 'exit-application'

export interface DiagnosticExportResult {
  canceled: boolean
  filePath?: string
}

export interface DesktopApi {
  platform: string
  versions: Readonly<{
    electron: string
    chrome: string
    node: string
  }>
  clearLogs(): Promise<boolean>
  exportDiagnosticBundle(): Promise<DiagnosticExportResult>
  openLogDirectory(): Promise<void>
  reportDiagnosticEvent(event: RendererDiagnosticEvent): void
  onCloseRequested(listener: () => void): () => void
  resolveCloseRequest(response: DesktopCloseResponse): Promise<boolean>
}
