import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { conversationUsageFromSession } from './agent-usage'

const usage = (input: number, output: number, cacheRead = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite: 0,
  totalTokens: input + output + cacheRead,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
})

function appendExchange(
  session: SessionManager,
  timestamp: number,
  input: number,
  output: number,
  cacheRead = 0,
): void {
  session.appendMessage({ role: 'user', content: 'hello', timestamp })
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'world' }],
    api: 'deepseek-messages',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(input, output, cacheRead),
    stopReason: 'stop',
    timestamp: timestamp + 1,
  })
}

describe('conversationUsageFromSession', () => {
  it('reports cumulative billed tokens and the latest context usage', () => {
    const session = SessionManager.inMemory('/project', {
      id: 'conversation-1',
    })
    appendExchange(session, 1, 80, 20)
    appendExchange(session, 3, 120, 30, 50)

    expect(conversationUsageFromSession(session, 1_000)).toEqual({
      totalTokens: 300,
      contextTokens: 200,
      contextWindow: 1_000,
      contextPercent: 20,
    })
  })

  it('marks context usage unknown immediately after compaction', () => {
    const session = SessionManager.inMemory('/project', {
      id: 'conversation-1',
    })
    appendExchange(session, 1, 80, 20)
    const firstEntryId = session.getBranch()[0].id
    session.appendCompaction(
      'summary',
      firstEntryId,
      100,
      undefined,
      false,
      usage(10, 5),
    )

    expect(conversationUsageFromSession(session, 1_000)).toEqual({
      totalTokens: 115,
      contextTokens: null,
      contextWindow: 1_000,
      contextPercent: null,
    })
  })
})
