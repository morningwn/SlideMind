import { describe, expect, it } from 'vitest'
import { ensureConversationDraft } from './conversation-state'

interface Conversation {
  id: string
  messages: string[]
}

function createConversation(id: string): Conversation {
  return { id, messages: [] }
}

describe('ensureConversationDraft', () => {
  it('reuses the same draft across repeated new-conversation actions', () => {
    const completed = { id: 'completed', messages: ['hello'] }
    const first = ensureConversationDraft([completed], () => createConversation('draft'))
    const second = ensureConversationDraft(first.conversations, () => createConversation('unused'))

    expect(second).toEqual({
      conversations: [createConversation('draft'), completed],
      selectedConversationId: 'draft'
    })
  })

  it('collapses duplicate empty conversations left by older versions', () => {
    const completed = { id: 'completed', messages: ['hello'] }

    expect(ensureConversationDraft([
      createConversation('first-draft'),
      completed,
      createConversation('duplicate-draft')
    ], () => createConversation('unused'))).toEqual({
      conversations: [createConversation('first-draft'), completed],
      selectedConversationId: 'first-draft'
    })
  })
})
