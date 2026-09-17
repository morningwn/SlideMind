import type {
  DiagnosticContextValue,
  RendererDiagnosticEventName,
  RendererDiagnosticLevel,
} from '../../../shared/logging'

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message
  return String(error)
}

export function reportDiagnosticEvent(
  level: RendererDiagnosticLevel,
  event: RendererDiagnosticEventName,
  error?: unknown,
  context?: Record<string, DiagnosticContextValue>,
): void {
  try {
    window.desktop.reportDiagnosticEvent({
      level,
      event,
      ...(error === undefined
        ? {}
        : { error: errorText(error).slice(0, 4_000) }),
      ...(context ? { context } : {}),
    })
  } catch {
    // Logging must never interrupt the user operation being diagnosed.
  }
}
