import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { AgentTodo } from '../../../shared/agent'
import type { ConversationMessage } from '../../../shared/project'
import { applyStreamEvents, createStreamBuffer } from '../lib/stream-buffer'
import { applyAgentActivityEvent } from '../lib/agent-activity'

export function useAgentEvents<T extends {
  id: string
  messages: Array<ConversationMessage & { isStreaming?: boolean }>
}>(
  setConversations: Dispatch<SetStateAction<T[]>>,
  setTodosByConversation: Dispatch<SetStateAction<Record<string, AgentTodo[]>>>
) {
  const [streamBuffer] = useState(() => createStreamBuffer((events) => {
    setConversations((current) => applyStreamEvents(current, events))
  }))

  useEffect(() => {
    const unsubscribe = window.agent.onStream(streamBuffer.push)
    return () => {
      unsubscribe()
      streamBuffer.drain()
    }
  }, [streamBuffer])

  useEffect(() => window.agent.onActivity((event) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === event.conversationId
        ? {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === event.requestId
                ? {
                    ...message,
                    activities: applyAgentActivityEvent(message.activities ?? [], event)
                  }
                : message
            )
          }
        : conversation
    ))
  }), [setConversations])

  useEffect(() => window.agent.onTodos((event) => {
    setTodosByConversation((current) => ({
      ...current,
      [event.conversationId]: event.todos
    }))
  }), [setTodosByConversation])

  return streamBuffer
}
