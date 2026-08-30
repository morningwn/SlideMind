import type { AgentTodo, AgentTodoStatus } from '../../shared/agent'

const TODO_TOOL_NAME = 'todo'
const MAX_TODOS = 1_000
const MAX_SUBJECT_LENGTH = 500
const MAX_ACTIVE_FORM_LENGTH = 500
const MAX_BLOCKERS = 100
const TODO_STATUSES = new Set<AgentTodoStatus>(['pending', 'in_progress', 'completed'])

function boundedOptionalString(value: unknown, maximumLength: number): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized || normalized.length > maximumLength) return null
  return normalized
}

function normalizeBlockers(value: unknown): number[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_BLOCKERS) return null

  const blockers: number[] = []
  for (const blocker of value) {
    if (!Number.isSafeInteger(blocker) || blocker <= 0 || blockers.includes(blocker)) return null
    blockers.push(blocker)
  }
  return blockers.length > 0 ? blockers : undefined
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
    ) return null

    const subject = boundedOptionalString(candidate.subject, MAX_SUBJECT_LENGTH)
    const activeForm = boundedOptionalString(candidate.activeForm, MAX_ACTIVE_FORM_LENGTH)
    const blockedBy = normalizeBlockers(candidate.blockedBy)
    if (!subject || activeForm === null || blockedBy === null) return null

    const todo: AgentTodo = {
      id: candidate.id as number,
      subject,
      status: candidate.status as AgentTodoStatus
    }
    if (activeForm) todo.activeForm = activeForm
    if (blockedBy) todo.blockedBy = blockedBy
    ids.add(todo.id)
    todos.push(todo)
  }
  return todos
}

function todosFromDetails(value: unknown): AgentTodo[] | null {
  if (!value || typeof value !== 'object') return null
  return normalizeAgentTodos((value as Record<string, unknown>).tasks)
}

export function todosFromToolResult(value: unknown): AgentTodo[] | null {
  if (!value || typeof value !== 'object') return null
  return todosFromDetails((value as Record<string, unknown>).details)
}

export function todosFromSessionEntries(entries: Iterable<unknown>): AgentTodo[] {
  let todos: AgentTodo[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    if (candidate.type !== 'message' || !candidate.message || typeof candidate.message !== 'object') {
      continue
    }

    const message = candidate.message as Record<string, unknown>
    if (message.role !== 'toolResult' || message.toolName !== TODO_TOOL_NAME) continue
    const snapshot = todosFromDetails(message.details)
    if (snapshot) todos = snapshot
  }
  return todos
}
