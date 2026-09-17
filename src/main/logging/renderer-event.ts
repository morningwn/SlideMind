import {
  RENDERER_DIAGNOSTIC_EVENTS,
  type DiagnosticContextValue,
  type RendererDiagnosticEvent,
} from '../../shared/logging'

const MAX_CONTEXT_ENTRIES = 12
const MAX_ERROR_LENGTH = 4_000
const MAX_KEY_LENGTH = 64
const MAX_STRING_LENGTH = 1_000
const eventNames = new Set<string>(RENDERER_DIAGNOSTIC_EVENTS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseContext(
  value: unknown,
): Record<string, DiagnosticContextValue> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > MAX_CONTEXT_ENTRIES) return undefined

  const context: Record<string, DiagnosticContextValue> = {}
  for (const [key, entry] of entries) {
    if (!key || key.length > MAX_KEY_LENGTH) return undefined
    if (
      entry !== null &&
      typeof entry !== 'boolean' &&
      typeof entry !== 'number' &&
      typeof entry !== 'string'
    )
      return undefined
    if (typeof entry === 'number' && !Number.isFinite(entry)) return undefined
    if (typeof entry === 'string' && entry.length > MAX_STRING_LENGTH)
      return undefined
    context[key] = entry
  }
  return context
}

export function parseRendererDiagnosticEvent(
  value: unknown,
): RendererDiagnosticEvent | undefined {
  if (!isRecord(value)) return undefined
  if (
    Object.keys(value).some(
      (key) => !['context', 'error', 'event', 'level'].includes(key),
    )
  ) {
    return undefined
  }
  if (value.level !== 'warn' && value.level !== 'error') return undefined
  if (typeof value.event !== 'string' || !eventNames.has(value.event))
    return undefined
  if (
    value.error !== undefined &&
    (typeof value.error !== 'string' || value.error.length > MAX_ERROR_LENGTH)
  )
    return undefined

  const context = parseContext(value.context)
  if (value.context !== undefined && context === undefined) return undefined
  return {
    level: value.level,
    event: value.event as RendererDiagnosticEvent['event'],
    ...(value.error === undefined ? {} : { error: value.error }),
    ...(context ? { context } : {}),
  }
}
