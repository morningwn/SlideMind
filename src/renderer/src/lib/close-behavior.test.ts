import { describe, expect, it, vi } from 'vitest'
import { resolveCloseBehavior } from './close-behavior'

describe('resolveCloseBehavior', () => {
  it('closes an active project while keeping the application window open', () => {
    const confirmDiscard = vi.fn()

    expect(resolveCloseBehavior(true, false, confirmDiscard)).toBe('close-project')
    expect(confirmDiscard).not.toHaveBeenCalled()
  })

  it('keeps an unsaved project open when discarding changes is cancelled', () => {
    expect(resolveCloseBehavior(true, true, () => false)).toBe('keep-window-open')
  })

  it('closes an unsaved project after discarding changes is confirmed', () => {
    expect(resolveCloseBehavior(true, true, () => true)).toBe('close-project')
  })

  it('exits the application when no project is active', () => {
    const confirmDiscard = vi.fn()

    expect(resolveCloseBehavior(false, false, confirmDiscard)).toBe('exit-application')
    expect(confirmDiscard).not.toHaveBeenCalled()
  })
})
