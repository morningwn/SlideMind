import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { SessionManager as PiSessionManager } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ConversationMessage,
  ProjectConversation,
  ProjectConversationState,
} from '../../shared/project'
import type { AgentActivity } from '../../shared/agent'
import { createToolActivity, toolErrorDetail } from '../agent/agent-activity'
import { resolveProject } from './recent-project-store'
import {
  findPiSessionFile,
  resolvePiConversationsDirectory,
  resolveProjectStorageDirectory,
} from './project-storage'

interface StoredProjectConversations extends ProjectConversationState {
  version: 2
}

interface PiSessionRuntime {
  SessionManager: typeof import('@earendil-works/pi-coding-agent').SessionManager
}

const STORAGE_FILE = 'conversations.json'
const MAX_MESSAGES_PER_CONVERSATION = 10_000
const MAX_MESSAGE_LENGTH = 2_000_000
const MAX_ID_LENGTH = 200
const MAX_TITLE_LENGTH = 500
const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

let piSessionRuntimePromise: Promise<PiSessionRuntime> | undefined

async function loadPiSessionRuntime(): Promise<PiSessionRuntime> {
  piSessionRuntimePromise ??= import('@earendil-works/pi-coding-agent').then(
    (runtime) => ({
      SessionManager: runtime.SessionManager,
    }),
  )
  return piSessionRuntimePromise
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximumLength &&
    value.trim().length > 0
  )
}

function isConversationId(value: unknown): value is string {
  return isBoundedString(value, MAX_ID_LENGTH) && SESSION_ID_PATTERN.test(value)
}

function isProjectConversation(value: unknown): value is ProjectConversation {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    isConversationId(candidate.id) &&
    isBoundedString(candidate.title, MAX_TITLE_LENGTH) &&
    (candidate.archived === undefined ||
      typeof candidate.archived === 'boolean')
  )
}

function isProjectConversationState(
  value: unknown,
): value is ProjectConversationState {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  if (
    !Array.isArray(candidate.conversations) ||
    candidate.conversations.length === 0 ||
    !candidate.conversations.every(isProjectConversation) ||
    !isConversationId(candidate.selectedConversationId)
  ) {
    return false
  }

  const ids = candidate.conversations.map((conversation) => conversation.id)
  return (
    new Set(ids).size === ids.length &&
    ids.includes(candidate.selectedConversationId)
  )
}

function isStoredProjectConversations(
  value: unknown,
): value is StoredProjectConversations {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).version === 2 &&
    isProjectConversationState(value)
  )
}

function extractText(message: AgentMessage): string | null {
  if (message.role !== 'assistant' && message.role !== 'user') return null

  const content: unknown = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null

  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        Boolean(block) &&
        typeof block === 'object' &&
        (block as Record<string, unknown>).type === 'text' &&
        typeof (block as Record<string, unknown>).text === 'string',
    )
    .map((block) => block.text)
    .join('')
}

function extractActivities(
  message: AgentMessage,
  entryId: string,
): AgentActivity[] {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return []

  const activities: AgentActivity[] = []
  for (const [index, block] of message.content.entries()) {
    if (block.type === 'thinking' && !block.redacted && block.thinking.trim()) {
      activities.push({
        id: `${entryId}:thinking:${index}`,
        kind: 'thinking',
        name: '模型思考',
        status: 'completed',
        content: block.thinking,
      })
    }
    if (block.type === 'toolCall') {
      activities.push(createToolActivity(block.id, block.name, block.arguments))
    }
  }
  return activities
}

export function visibleUserPrompt(text: string): string {
  const startMarker = '\n\n<slidemind-injected-context version="1">'
  const endMarker = '\n</slidemind-injected-context>'
  if (!text.endsWith(endMarker)) return text
  const contextStart = text.lastIndexOf(startMarker)
  return contextStart < 0 ? text : text.slice(0, contextStart)
}

function projectMessages(
  sessionManager: PiSessionManager,
): ConversationMessage[] {
  const messages: ConversationMessage[] = []
  const activitiesByToolCall = new Map<string, AgentActivity>()
  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== 'message') continue

    if (entry.message.role === 'toolResult') {
      const activity = activitiesByToolCall.get(entry.message.toolCallId)
      if (activity) {
        activity.status = entry.message.isError ? 'error' : 'completed'
        if (entry.message.isError) {
          const errorDetail = toolErrorDetail(entry.message)
          if (errorDetail) {
            activity.detail = [activity.detail, `错误：${errorDetail}`]
              .filter(Boolean)
              .join('\n\n')
          }
        }
      }
      continue
    }

    const text = extractText(entry.message)
    if (
      text === null ||
      (entry.message.role !== 'assistant' && entry.message.role !== 'user')
    ) {
      continue
    }
    if (
      text.length > MAX_MESSAGE_LENGTH ||
      messages.length >= MAX_MESSAGES_PER_CONVERSATION
    ) {
      throw new Error('Pi 会话记录超出显示限制')
    }
    const activities = extractActivities(entry.message, entry.id)
    for (const activity of activities) {
      if (activity.kind !== 'thinking')
        activitiesByToolCall.set(activity.id, activity)
    }
    const visibleText =
      entry.message.role === 'user' ? visibleUserPrompt(text) : text
    const previousMessage = messages.at(-1)
    if (
      entry.message.role === 'assistant' &&
      previousMessage?.role === 'assistant'
    ) {
      previousMessage.text = [previousMessage.text, visibleText]
        .filter(Boolean)
        .join('\n\n')
      if (activities.length > 0) {
        previousMessage.activities = [
          ...(previousMessage.activities ?? []),
          ...activities,
        ]
      }
      continue
    }
    messages.push({
      id: entry.id,
      role: entry.message.role,
      text: visibleText,
      ...(activities.length > 0 ? { activities } : {}),
    })
  }
  return messages
}

export class ProjectConversationStore {
  private readonly writeQueues = new Map<string, Promise<void>>()

  async load(
    projectPathInput: unknown,
  ): Promise<ProjectConversationState | null> {
    const project = await resolveProject(projectPathInput)
    const pendingWrite = this.writeQueues.get(project.path)
    if (pendingWrite) await pendingWrite

    const storagePath = await resolveProjectStorageDirectory(
      project.path,
      false,
    )
    if (!storagePath) return null

    const conversationPath = join(storagePath, STORAGE_FILE)
    try {
      await this.rejectSymbolicLink(conversationPath)
      const stored: unknown = JSON.parse(
        await readFile(conversationPath, 'utf8'),
      )
      if (!isStoredProjectConversations(stored)) {
        throw new Error('项目会话记录格式无效')
      }

      return {
        conversations: stored.conversations,
        selectedConversationId: stored.selectedConversationId,
      }
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? error.code : undefined
      if (code === 'ENOENT') return null
      if (error instanceof SyntaxError) throw new Error('项目会话记录格式无效')
      throw error
    }
  }

  async loadMessages(
    projectPathInput: unknown,
    conversationIdInput: unknown,
  ): Promise<ConversationMessage[]> {
    const project = await resolveProject(projectPathInput)
    if (!isConversationId(conversationIdInput))
      throw new Error('项目会话标识无效')

    const conversationsDirectory = await resolvePiConversationsDirectory(
      project.path,
      false,
    )
    if (!conversationsDirectory) return []

    const { SessionManager } = await loadPiSessionRuntime()
    const sessionPath = await findPiSessionFile(
      conversationsDirectory,
      conversationIdInput,
    )
    if (!sessionPath) return []
    const sessionManager = SessionManager.open(
      sessionPath,
      conversationsDirectory,
      project.path,
    )
    if (sessionManager.getSessionId() !== conversationIdInput) {
      throw new Error('Pi 会话记录标识不匹配')
    }
    return projectMessages(sessionManager)
  }

  save(projectPathInput: unknown, stateInput: unknown): Promise<void> {
    if (!isProjectConversationState(stateInput)) {
      return Promise.reject(new Error('项目会话记录无效'))
    }

    const state = structuredClone(stateInput)
    return this.enqueue(projectPathInput, async (projectPath) => {
      const storagePath = await resolveProjectStorageDirectory(
        projectPath,
        true,
      )
      if (!storagePath) throw new Error('无法创建项目会话存储目录')

      const conversationPath = join(storagePath, STORAGE_FILE)
      await this.rejectSymbolicLink(conversationPath)
      const temporaryPath = join(
        storagePath,
        `${STORAGE_FILE}.${process.pid}-${randomUUID()}.tmp`,
      )
      const stored: StoredProjectConversations = { version: 2, ...state }

      try {
        await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        })
        await rename(temporaryPath, conversationPath)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
    })
  }

  private async enqueue(
    projectPathInput: unknown,
    operation: (projectPath: string) => Promise<void>,
  ): Promise<void> {
    const queueKey =
      typeof projectPathInput === 'string' ? projectPathInput : ''
    const previousWrite = this.writeQueues.get(queueKey) ?? Promise.resolve()
    const result = previousWrite.then(
      async () => operation((await resolveProject(projectPathInput)).path),
      async () => operation((await resolveProject(projectPathInput)).path),
    )
    const queue = result.then(
      () => undefined,
      () => undefined,
    )
    this.writeQueues.set(queueKey, queue)
    void queue.finally(() => {
      if (this.writeQueues.get(queueKey) === queue)
        this.writeQueues.delete(queueKey)
    })
    return result
  }

  private async rejectSymbolicLink(path: string): Promise<void> {
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        throw new Error('项目会话记录文件无效')
      }
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') throw error
    }
  }
}
