import type { AgentTodo, AgentTodoStatus } from '../../shared/agent'

const MAX_TODOS = 1_000
const MAX_SUBJECT_LENGTH = 500
const MAX_ACTIVE_FORM_LENGTH = 500
const TODO_STATUSES = new Set<AgentTodoStatus>([
  'pending',
  'in_progress',
  'completed',
])

export interface TodoSnapshot {
  version: 1
  tasks: AgentTodo[]
  nextId: number
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maximumLength ? normalized : null
}

export function normalizeAgentTodos(value: unknown): AgentTodo[] | null {
  if (!Array.isArray(value) || value.length > MAX_TODOS) return null
  const todos: AgentTodo[] = []
  const ids = new Set<number>()
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const candidate = item as Record<string, unknown>
    if (candidate.status === 'deleted') continue
    if (
      !Number.isSafeInteger(candidate.id) ||
      (candidate.id as number) <= 0 ||
      ids.has(candidate.id as number) ||
      !TODO_STATUSES.has(candidate.status as AgentTodoStatus)
    )
      return null
    const subject = boundedString(candidate.subject, MAX_SUBJECT_LENGTH)
    const activeForm =
      candidate.activeForm === undefined
        ? undefined
        : boundedString(candidate.activeForm, MAX_ACTIVE_FORM_LENGTH)
    if (!subject || activeForm === null) return null
    const todo: AgentTodo = {
      id: candidate.id as number,
      subject,
      status: candidate.status as AgentTodoStatus,
    }
    if (activeForm) todo.activeForm = activeForm
    ids.add(todo.id)
    todos.push(todo)
  }
  return todos
}

function snapshotFromDetails(value: unknown): TodoSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const details = value as Record<string, unknown>
  if (details.version !== undefined && details.version !== 1) return null
  const tasks = normalizeAgentTodos(details.tasks)
  if (!tasks) return null
  if (
    details.version === 1 &&
    tasks.filter((task) => task.status === 'in_progress').length > 1
  )
    return null
  const minimumNextId = Math.max(0, ...tasks.map((task) => task.id)) + 1
  const nextId = details.nextId === undefined ? minimumNextId : details.nextId
  if (!Number.isSafeInteger(nextId) || (nextId as number) < minimumNextId)
    return null
  return { version: 1, tasks, nextId: nextId as number }
}

export function snapshotFromToolResult(value: unknown): TodoSnapshot | null {
  if (!value || typeof value !== 'object') return null
  return snapshotFromDetails((value as Record<string, unknown>).details)
}

export function todosFromToolResult(value: unknown): AgentTodo[] | null {
  return snapshotFromToolResult(value)?.tasks ?? null
}

export function snapshotFromSessionEntries(
  entries: Iterable<unknown>,
): TodoSnapshot {
  let snapshot: TodoSnapshot = { version: 1, tasks: [], nextId: 1 }
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    if (
      candidate.type !== 'message' ||
      !candidate.message ||
      typeof candidate.message !== 'object'
    )
      continue
    const message = candidate.message as Record<string, unknown>
    if (
      message.role !== 'toolResult' ||
      message.toolName !== 'todo' ||
      message.isError === true
    )
      continue
    const next = snapshotFromDetails(message.details)
    if (next) snapshot = next
  }
  return snapshot
}

export function todosFromSessionEntries(
  entries: Iterable<unknown>,
): AgentTodo[] {
  return snapshotFromSessionEntries(entries).tasks
}
