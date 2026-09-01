export type ContextUsageTone = 'normal' | 'warning' | 'critical'

function compactValue(value: number, divisor: number, suffix: string): string {
  const scaled = value / divisor
  const digits = scaled >= 100 ? 0 : 1
  return `${scaled.toFixed(digits).replace(/\.0$/, '')}${suffix}`
}

export function formatTokenCount(value: number): string {
  const tokens = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  if (tokens >= 1_000_000) return compactValue(tokens, 1_000_000, 'M')
  if (tokens >= 1_000) return compactValue(tokens, 1_000, 'K')
  return tokens.toLocaleString('en-US')
}

export function contextUsageTone(percent: number | null): ContextUsageTone {
  if (percent !== null && percent >= 90) return 'critical'
  if (percent !== null && percent >= 70) return 'warning'
  return 'normal'
}
