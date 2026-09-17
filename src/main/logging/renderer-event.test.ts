import { describe, expect, it } from 'vitest'
import { parseRendererDiagnosticEvent } from './renderer-event'

describe('parseRendererDiagnosticEvent', () => {
  it('accepts an allowlisted event with primitive metadata', () => {
    expect(
      parseRendererDiagnosticEvent({
        event: 'agent.todos_load_failed',
        level: 'warn',
        error: 'network failed',
        context: { retryable: true },
      }),
    ).toEqual({
      event: 'agent.todos_load_failed',
      level: 'warn',
      error: 'network failed',
      context: { retryable: true },
    })
  })

  it('rejects unknown events, fields, and nested context', () => {
    expect(
      parseRendererDiagnosticEvent({ event: 'custom', level: 'warn' }),
    ).toBeUndefined()
    expect(
      parseRendererDiagnosticEvent({
        event: 'renderer.unhandled_error',
        level: 'error',
        extra: 'unexpected',
      }),
    ).toBeUndefined()
    expect(
      parseRendererDiagnosticEvent({
        event: 'renderer.unhandled_error',
        level: 'error',
        context: { nested: { secret: true } },
      }),
    ).toBeUndefined()
  })
})
