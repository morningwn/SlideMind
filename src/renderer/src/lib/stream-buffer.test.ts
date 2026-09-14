import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyStreamEvents, createStreamBuffer, isNearMessageBottom } from './stream-buffer'

afterEach(() => vi.useRealTimers())

describe('createStreamBuffer', () => {
  it('coalesces increments without mixing conversations or requests', () => {
    vi.useFakeTimers()
    const consume = vi.fn()
    const buffer = createStreamBuffer(consume)
    buffer.push({ conversationId: 'a', requestId: '1', delta: 'hello' })
    buffer.push({ conversationId: 'b', requestId: '1', delta: 'other' })
    buffer.push({ conversationId: 'a', requestId: '2', delta: 'next' })
    buffer.push({ conversationId: 'a', requestId: '1', delta: ' world' })
    expect(consume).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(consume).toHaveBeenCalledExactlyOnceWith([
      { conversationId: 'a', requestId: '1', delta: 'hello world' },
      { conversationId: 'a', requestId: '2', delta: 'next' },
      { conversationId: 'b', requestId: '1', delta: 'other' }
    ])
  })

  it('flushes pending text before completion and cancels its timer', () => {
    vi.useFakeTimers()
    const consume = vi.fn()
    const buffer = createStreamBuffer(consume)
    buffer.push({ conversationId: 'a', requestId: '1', delta: 'partial' })
    buffer.flush()
    vi.advanceTimersByTime(100)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(buffer.drain()).toEqual([])
  })

  it('discards pending work on disposal', () => {
    vi.useFakeTimers()
    const consume = vi.fn()
    const buffer = createStreamBuffer(consume)
    buffer.push({ conversationId: 'a', requestId: '1', delta: 'partial' })
    buffer.drain()
    vi.advanceTimersByTime(100)
    expect(consume).not.toHaveBeenCalled()
  })
})

describe('isNearMessageBottom', () => {
  it('follows the bottom but preserves history reading position', () => {
    expect(isNearMessageBottom({ scrollHeight: 1000, scrollTop: 520, clientHeight: 400 })).toBe(true)
    expect(isNearMessageBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 400 })).toBe(false)
  })
})

describe('applyStreamEvents', () => {
  it('updates the originating conversation while preserving completed messages', () => {
    const conversations = [
      { id: 'a', messages: [{ id: '1', text: 'old', isStreaming: true }] },
      { id: 'b', messages: [{ id: '1', text: 'final', isStreaming: false }] }
    ]
    const result = applyStreamEvents(conversations, [
      { conversationId: 'a', requestId: '1', delta: ' new' },
      { conversationId: 'b', requestId: '1', delta: ' late' }
    ])
    expect(result[0].messages[0].text).toBe('old new')
    expect(result[1].messages[0]).toBe(conversations[1].messages[0])
    expect(conversations[0].messages[0].text).toBe('old')
  })

  it('retains buffered partial output before a failed request finishes', () => {
    vi.useFakeTimers()
    let conversations = [{ id: 'a', messages: [{ id: '1', text: '', isStreaming: true }] }]
    const buffer = createStreamBuffer((events) => {
      conversations = applyStreamEvents(conversations, events)
    })
    buffer.push({ conversationId: 'a', requestId: '1', delta: 'partial' })
    buffer.flush()
    conversations[0].messages[0].isStreaming = false
    vi.advanceTimersByTime(100)
    expect(conversations[0].messages[0].text).toBe('partial')
  })
})
