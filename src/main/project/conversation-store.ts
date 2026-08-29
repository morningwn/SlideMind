import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, sep } from 'node:path'
import type {
  ConversationMessage,
  ProjectConversation,
  ProjectConversationState
} from '../../shared/project'
import { resolveProject } from './recent-project-store'

interface StoredProjectConversations extends ProjectConversationState {
  version: 1
}

const STORAGE_DIRECTORY = '.slideMind'
const STORAGE_FILE = 'conversations.json'
const MAX_CONVERSATIONS = 500
const MAX_MESSAGES_PER_CONVERSATION = 10_000
const MAX_ID_LENGTH = 200
const MAX_TITLE_LENGTH = 500
const MAX_MESSAGE_LENGTH = 2_000_000

function isBoundedString(value: unknown, maximumLength: number, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximumLength &&
    (allowEmpty || value.trim().length > 0)
  )
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    isBoundedString(candidate.id, MAX_ID_LENGTH) &&
    (candidate.role === 'assistant' || candidate.role === 'user') &&
    isBoundedString(candidate.text, MAX_MESSAGE_LENGTH, true)
  )
}

function isProjectConversation(value: unknown): value is ProjectConversation {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    isBoundedString(candidate.id, MAX_ID_LENGTH) &&
    isBoundedString(candidate.title, MAX_TITLE_LENGTH) &&
    Array.isArray(candidate.messages) &&
    candidate.messages.length <= MAX_MESSAGES_PER_CONVERSATION &&
    candidate.messages.every(isConversationMessage)
  )
}

function isProjectConversationState(value: unknown): value is ProjectConversationState {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  if (
    !Array.isArray(candidate.conversations) ||
    candidate.conversations.length === 0 ||
    candidate.conversations.length > MAX_CONVERSATIONS ||
    !candidate.conversations.every(isProjectConversation) ||
    !isBoundedString(candidate.selectedConversationId, MAX_ID_LENGTH)
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
    (value as Record<string, unknown>).version === 1 &&
    isProjectConversationState(value)
  )
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return candidatePath === projectPath || candidatePath.startsWith(`${projectPath}${sep}`)
}

async function ensureSafeStorageDirectory(projectPath: string): Promise<string> {
  const storagePath = join(projectPath, STORAGE_DIRECTORY)

  try {
    const stats = await lstat(storagePath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('项目会话存储目录无效')
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw error
    await mkdir(storagePath, { mode: 0o700 })
  }

  const canonicalStoragePath = await realpath(storagePath)
  if (!isInsideProject(projectPath, canonicalStoragePath)) {
    throw new Error('项目会话存储目录超出项目范围')
  }

  return canonicalStoragePath
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error('项目会话记录文件无效')
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw error
  }
}

export class ProjectConversationStore {
  private readonly writeQueues = new Map<string, Promise<void>>()

  async load(projectPathInput: unknown): Promise<ProjectConversationState | null> {
    const project = await resolveProject(projectPathInput)
    const pendingWrite = this.writeQueues.get(project.path)
    if (pendingWrite) await pendingWrite

    const storagePath = join(project.path, STORAGE_DIRECTORY)
    const conversationPath = join(storagePath, STORAGE_FILE)

    try {
      const storageStats = await lstat(storagePath)
      if (storageStats.isSymbolicLink() || !storageStats.isDirectory()) {
        throw new Error('项目会话存储目录无效')
      }
      await rejectSymbolicLink(conversationPath)
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

  save(projectPathInput: unknown, stateInput: unknown): Promise<void> {
    if (!isProjectConversationState(stateInput)) {
      return Promise.reject(new Error('项目会话记录无效'))
    }

    const state = structuredClone(stateInput)
    return this.enqueue(projectPathInput, async (projectPath) => {
      const storagePath = await ensureSafeStorageDirectory(projectPath)
      const conversationPath = join(storagePath, STORAGE_FILE)
      await rejectSymbolicLink(conversationPath)

      const temporaryPath = join(storagePath, `${STORAGE_FILE}.${process.pid}-${randomUUID()}.tmp`)
      const stored: StoredProjectConversations = { version: 1, ...state }

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
    const project = await resolveProject(projectPathInput)
    const previousWrite = this.writeQueues.get(project.path) ?? Promise.resolve()
    const result = previousWrite.then(
      () => operation(project.path),
      () => operation(project.path)
    )
    const queue = result.then(
      () => undefined,
      () => undefined
    )
    this.writeQueues.set(project.path, queue)
    void queue.finally(() => {
      if (this.writeQueues.get(project.path) === queue) this.writeQueues.delete(project.path)
    })
    return result
  }
}
