import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { SessionManager as PiSessionManager } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ConversationMessage,
  ProjectConversation,
  ProjectConversationState
} from '../../shared/project'
import { resolveProject } from './recent-project-store'
import {
  findPiSessionFile,
  resolvePiConversationsDirectory,
  resolveProjectStorageDirectory
} from './project-storage'

interface StoredProjectConversations extends ProjectConversationState {
  version: 2
}

interface PiSessionRuntime {
  SessionManager: typeof import('@earendil-works/pi-coding-agent').SessionManager
}

const STORAGE_FILE = 'conversations.json'
const MAX_CONVERSATIONS = 500
const MAX_MESSAGES_PER_CONVERSATION = 10_000
const MAX_MESSAGE_LENGTH = 2_000_000
const MAX_ID_LENGTH = 200
const MAX_TITLE_LENGTH = 500
const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

let piSessionRuntimePromise: Promise<PiSessionRuntime> | undefined

async function loadPiSessionRuntime(): Promise<PiSessionRuntime> {
  piSessionRuntimePromise ??= import('@earendil-works/pi-coding-agent').then((runtime) => ({
    SessionManager: runtime.SessionManager
  }))
  return piSessionRuntimePromise
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength && value.trim().length > 0
}

function isConversationId(value: unknown): value is string {
  return isBoundedString(value, MAX_ID_LENGTH) && SESSION_ID_PATTERN.test(value)
}

function isProjectConversation(value: unknown): value is ProjectConversation {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return isConversationId(candidate.id) && isBoundedString(candidate.title, MAX_TITLE_LENGTH)
}

function isProjectConversationState(value: unknown): value is ProjectConversationState {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  if (
    !Array.isArray(candidate.conversations) ||
    candidate.conversations.length === 0 ||
    candidate.conversations.length > MAX_CONVERSATIONS ||
    !candidate.conversations.every(isProjectConversation) ||
    !isConversationId(candidate.selectedConversationId)
  ) {
    return false
  }

  const ids = candidate.conversations.map((conversation) => conversation.id)
  return new Set(ids).size === ids.length && ids.includes(candidate.selectedConversationId)
}

function isStoredProjectConversations(value: unknown): value is StoredProjectConversations {
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
    .filter((block): block is { type: 'text'; text: string } => (
      Boolean(block) &&
      typeof block === 'object' &&
      (block as Record<string, unknown>).type === 'text' &&
      typeof (block as Record<string, unknown>).text === 'string'
    ))
    .map((block) => block.text)
    .join('')
}

function projectMessages(sessionManager: PiSessionManager): ConversationMessage[] {
  const messages: ConversationMessage[] = []
  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== 'message') continue

    const text = extractText(entry.message)
    if (text === null || (entry.message.role !== 'assistant' && entry.message.role !== 'user')) {
      continue
    }
    if (text.length > MAX_MESSAGE_LENGTH || messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
      throw new Error('Pi 会话记录超出显示限制')
    }
    messages.push({ id: entry.id, role: entry.message.role, text })
  }
  return messages
}

export class ProjectConversationStore {
  private readonly writeQueues = new Map<string, Promise<void>>()

  async load(projectPathInput: unknown): Promise<ProjectConversationState | null> {
    const project = await resolveProject(projectPathInput)
    const pendingWrite = this.writeQueues.get(project.path)
    if (pendingWrite) await pendingWrite

    const storagePath = await resolveProjectStorageDirectory(project.path, false)
    if (!storagePath) return null

    const conversationPath = join(storagePath, STORAGE_FILE)
    try {
      await this.rejectSymbolicLink(conversationPath)
      const stored: unknown = JSON.parse(await readFile(conversationPath, 'utf8'))
      if (!isStoredProjectConversations(stored)) {
        throw new Error('项目会话记录格式无效')
      }

      return {
        conversations: stored.conversations,
        selectedConversationId: stored.selectedConversationId
      }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code === 'ENOENT') return null
      if (error instanceof SyntaxError) throw new Error('项目会话记录格式无效')
      throw error
    }
  }

  async loadMessages(
    projectPathInput: unknown,
    conversationIdInput: unknown
  ): Promise<ConversationMessage[]> {
    const project = await resolveProject(projectPathInput)
    if (!isConversationId(conversationIdInput)) throw new Error('项目会话标识无效')

    const conversationsDirectory = await resolvePiConversationsDirectory(project.path, false)
    if (!conversationsDirectory) return []

    const { SessionManager } = await loadPiSessionRuntime()
    const sessionPath = await findPiSessionFile(conversationsDirectory, conversationIdInput)
    if (!sessionPath) return []
    const sessionManager = SessionManager.open(
      sessionPath,
      conversationsDirectory,
      project.path
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
      const storagePath = await resolveProjectStorageDirectory(projectPath, true)
      if (!storagePath) throw new Error('无法创建项目会话存储目录')

      const conversationPath = join(storagePath, STORAGE_FILE)
      await this.rejectSymbolicLink(conversationPath)
      const temporaryPath = join(storagePath, `${STORAGE_FILE}.${process.pid}-${randomUUID()}.tmp`)
      const stored: StoredProjectConversations = { version: 2, ...state }

      try {
        await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600
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
    operation: (projectPath: string) => Promise<void>
  ): Promise<void> {
    const queueKey = typeof projectPathInput === 'string' ? projectPathInput : ''
    const previousWrite = this.writeQueues.get(queueKey) ?? Promise.resolve()
    const result = previousWrite.then(
      async () => operation((await resolveProject(projectPathInput)).path),
      async () => operation((await resolveProject(projectPathInput)).path)
    )
    const queue = result.then(
      () => undefined,
      () => undefined
    )
    this.writeQueues.set(queueKey, queue)
    void queue.finally(() => {
      if (this.writeQueues.get(queueKey) === queue) this.writeQueues.delete(queueKey)
    })
    return result
  }

  private async rejectSymbolicLink(path: string): Promise<void> {
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        throw new Error('项目会话记录文件无效')
      }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') throw error
    }
  }
}
