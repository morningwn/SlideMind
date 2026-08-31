import { describe, expect, it } from 'vitest'
import { sanitizeContext, sanitizeError, sanitizeText } from './sanitize'

describe('logging sanitizer', () => {
  it('redacts credentials and configured user paths', () => {
    expect(sanitizeText(
      'Bearer abc.def apiKey=plain "token":"json secret" sk-1234567890 /Users/alice/project/deck.md',
      { sensitivePaths: ['/Users/alice'] }
    )).toBe(
      'Bearer [REDACTED] apiKey=[REDACTED] "token":[REDACTED] [REDACTED] [USER_PATH]/project/deck.md'
    )
  })

  it('redacts sensitive context fields without dropping safe metadata', () => {
    expect(sanitizeContext({
      apiKey: 'secret',
      durationMs: 42,
      modelId: 'deepseek-v4-flash',
      promptLength: 100
    })).toEqual({
      apiKey: '[REDACTED]',
      durationMs: 42,
      modelId: 'deepseek-v4-flash',
      promptLength: 100
    })
  })

  it('serializes Error and non-Error failures safely', () => {
    const error = Object.assign(new Error('token=private'), { code: 'E_TEST' })
    expect(sanitizeError(error)).toMatchObject({
      code: 'E_TEST',
      message: 'token=[REDACTED]',
      name: 'Error'
    })
    expect(sanitizeError('Bearer private')).toEqual({
      message: 'Bearer [REDACTED]',
      name: 'NonError'
    })
  })

  it('truncates unexpectedly large values', () => {
    expect(sanitizeText('x'.repeat(3_000))).toMatch(/…\[truncated\]$/)
  })
})
