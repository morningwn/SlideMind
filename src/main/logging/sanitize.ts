import type { DiagnosticContextValue } from '../../shared/logging'

const MAX_CONTEXT_KEY_LENGTH = 64
const MAX_CONTEXT_STRING_LENGTH = 500
const MAX_ERROR_MESSAGE_LENGTH = 2_000
const MAX_ERROR_STACK_LENGTH = 8_000
const REDACTED = '[REDACTED]'
const SENSITIVE_KEY_PATTERN = /^(?:api.?key|authorization|cookie|password|prompt|response|secret|token)$/i

export interface SanitizedError {
  code?: string
  message: string
  name: string
  stack?: string
}

export interface SanitizeOptions {
  sensitivePaths?: readonly string[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…[truncated]`
}

export function sanitizeText(
  value: string,
  options: SanitizeOptions = {},
  limit = MAX_ERROR_MESSAGE_LENGTH
): string {
  let sanitized = value
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, REDACTED)
    .replace(
      /(\b(?:api[-_ ]?key|authorization|cookie|password|secret|token)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      (_match, prefix: string) => `${prefix}${REDACTED}`
    )

  for (const path of options.sensitivePaths ?? []) {
    if (!path) continue
    sanitized = sanitized.replace(new RegExp(escapeRegExp(path), 'g'), '[USER_PATH]')
  }

  return truncate(sanitized, limit)
}

function errorCode(error: Error): string | undefined {
  if (!('code' in error)) return undefined
  const code = error.code
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined
}

export function sanitizeError(
  error: unknown,
  options: SanitizeOptions = {}
): SanitizedError {
  if (!(error instanceof Error)) {
    return {
      name: 'NonError',
      message: sanitizeText(String(error), options)
    }
  }

  const code = errorCode(error)
  return {
    name: sanitizeText(error.name || 'Error', options, 200),
    message: sanitizeText(error.message, options),
    ...(code ? { code: sanitizeText(code, options, 200) } : {}),
    ...(error.stack
      ? { stack: sanitizeText(error.stack, options, MAX_ERROR_STACK_LENGTH) }
      : {})
  }
}

export function sanitizeContext(
  context: Readonly<Record<string, DiagnosticContextValue>> | undefined,
  options: SanitizeOptions = {}
): Record<string, DiagnosticContextValue> | undefined {
  if (!context) return undefined

  const sanitized: Record<string, DiagnosticContextValue> = {}
  for (const [rawKey, value] of Object.entries(context)) {
    const key = truncate(rawKey, MAX_CONTEXT_KEY_LENGTH)
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = REDACTED
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeText(value, options, MAX_CONTEXT_STRING_LENGTH)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}
