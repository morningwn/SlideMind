import { describe, expect, it } from 'vitest'
import { getPlatformLabel } from './platform'

describe('getPlatformLabel', () => {
  it.each([
    ['darwin', 'macOS'],
    ['win32', 'Windows'],
    ['linux', 'Desktop'],
  ] as const)('maps %s to %s', (platform, label) => {
    expect(getPlatformLabel(platform)).toBe(label)
  })
})
