interface ConversationStateItem {
  id: string
  messages: readonly unknown[]
}

interface ConversationDraftState<T extends ConversationStateItem> {
  conversations: T[]
  selectedConversationId: string
}

export function ensureConversationDraft<T extends ConversationStateItem>(
  conversations: T[],
  createConversation: () => T
): ConversationDraftState<T> {
  const existingDraft = conversations.find((conversation) => conversation.messages.length === 0)
  if (existingDraft) {
    return {
      conversations: conversations.filter(
        (conversation) => conversation.messages.length > 0 || conversation.id === existingDraft.id
      ),
      selectedConversationId: existingDraft.id
    }
  }

  const conversation = createConversation()
  return {
    conversations: [conversation, ...conversations],
    selectedConversationId: conversation.id
  }
}
