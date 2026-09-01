import { describe, expect, it } from 'vitest'
import { contextUsageTone, formatTokenCount } from './agent-usage'

describe('formatTokenCount', () => {
  it('formats token counts for a compact information bar', () => {
    expect(formatTokenCount(980)).toBe('980')
    expect(formatTokenCount(12_450)).toBe('12.4K')
    expect(formatTokenCount(1_250_000)).toBe('1.3M')
  })
})

describe('contextUsageTone', () => {
  it('raises the context warning level at 70 and 90 percent', () => {
    expect(contextUsageTone(null)).toBe('normal')
    expect(contextUsageTone(69.9)).toBe('normal')
    expect(contextUsageTone(70)).toBe('warning')
    expect(contextUsageTone(90)).toBe('critical')
  })
})
