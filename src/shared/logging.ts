export const RENDERER_DIAGNOSTIC_EVENTS = [
  'agent.todos_load_failed',
  'agent.usage_load_failed',
  'conversation.flush_failed',
  'presentation.editor_failed',
  'renderer.react_error',
  'renderer.unhandled_error',
  'renderer.unhandled_rejection',
] as const

export type RendererDiagnosticEventName =
  (typeof RENDERER_DIAGNOSTIC_EVENTS)[number]
export type RendererDiagnosticLevel = 'warn' | 'error'
export type DiagnosticContextValue = string | number | boolean | null

export interface RendererDiagnosticEvent {
  context?: Record<string, DiagnosticContextValue>
  error?: string
  event: RendererDiagnosticEventName
  level: RendererDiagnosticLevel
}
