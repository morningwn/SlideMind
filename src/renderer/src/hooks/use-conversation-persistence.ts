import { useEffect, useRef } from 'react'
import type { ProjectConversationState } from '../../../shared/project'
import { reportDiagnosticEvent } from '../lib/logger'

function toPersistedState(
  conversations: ProjectConversationState['conversations'],
  selectedConversationId: string
): ProjectConversationState {
  return {
    selectedConversationId,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      ...(conversation.archived !== undefined ? { archived: conversation.archived } : {})
    }))
  }
}

interface ConversationPersistenceOptions extends ProjectConversationState {
  projectHandle: string
  enabled: boolean
  onError: (message: string) => void
}

export function useConversationPersistence({
  projectHandle,
  conversations,
  selectedConversationId,
  enabled,
  onError
}: ConversationPersistenceOptions) {
  const lastSavedConversationSnapshotRef = useRef('')
  const latestConversationStateRef = useRef({ conversations, selectedConversationId })
  const canFlushConversationsRef = useRef(false)
  latestConversationStateRef.current = { conversations, selectedConversationId }
  canFlushConversationsRef.current = enabled

  useEffect(() => {
    if (!enabled) return

    const timer = window.setTimeout(() => {
      const state = toPersistedState(conversations, selectedConversationId)
      const snapshot = JSON.stringify(state)
      if (snapshot === lastSavedConversationSnapshotRef.current) return
      void window.projects
        .saveConversations(projectHandle, state)
        .then(() => {
          lastSavedConversationSnapshotRef.current = snapshot
          onError('')
        })
        .catch((error: unknown) => {
          onError(error instanceof Error ? error.message : '无法保存项目会话')
        })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [enabled, conversations, projectHandle, selectedConversationId, onError])

  useEffect(() => () => {
    if (!canFlushConversationsRef.current) return

    const latest = latestConversationStateRef.current
    const state = toPersistedState(latest.conversations, latest.selectedConversationId)
    const snapshot = JSON.stringify(state)
    if (snapshot === lastSavedConversationSnapshotRef.current) return

    void window.projects.saveConversations(projectHandle, state).catch((error: unknown) => {
      reportDiagnosticEvent('warn', 'conversation.flush_failed', error)
    })
  }, [projectHandle])

  return lastSavedConversationSnapshotRef
}
