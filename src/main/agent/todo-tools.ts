import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { AgentTodo, AgentTodoStatus } from '../../shared/agent'
import { snapshotFromSessionEntries, type TodoSnapshot } from './agent-todo'

const MAX_TODOS = 1_000
const MAX_TEXT_LENGTH = 500
const STATUSES = new Set<AgentTodoStatus>([
  'pending',
  'in_progress',
  'completed',
])

type TodoInput = {
  action: 'replace' | 'add' | 'update' | 'list'
  tasks?: Array<{
    subject: string
    status: AgentTodoStatus
    activeForm?: string
  }>
  subject?: string
  activeForm?: string
  id?: number
  status?: AgentTodoStatus
}

function validateText(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > MAX_TEXT_LENGTH
  ) {
    throw new Error(`${field} 必须是 1–${MAX_TEXT_LENGTH} 字符的非空文本`)
  }
  return value.trim()
}

function validateStatus(value: unknown): AgentTodoStatus {
  if (!STATUSES.has(value as AgentTodoStatus)) throw new Error('任务状态无效')
  return value as AgentTodoStatus
}

function validateSingleActive(tasks: AgentTodo[]): void {
  if (tasks.filter((task) => task.status === 'in_progress').length > 1) {
    throw new Error('同一清单只能有一项进行中任务')
  }
}

function validateFields(input: TodoInput, allowed: string[]): void {
  const unexpected = Object.keys(input).find(
    (field) => !allowed.includes(field),
  )
  if (unexpected) throw new Error(`当前操作不接受字段：${unexpected}`)
}

export function createTodoToolsExtension(
  onRestore?: (tasks: AgentTodo[]) => void,
  getSessionEntries?: () => Iterable<unknown>,
): ExtensionFactory {
  return async (pi) => {
    const { Type } = await import('@earendil-works/pi-ai')
    let state: TodoSnapshot = { version: 1, tasks: [], nextId: 1 }
    const restore = (entries: Iterable<unknown>): void => {
      state = snapshotFromSessionEntries(entries)
      onRestore?.(structuredClone(state.tasks))
    }
    if (getSessionEntries) restore(getSessionEntries())
    pi.on('session_start', (_event, ctx) =>
      restore(ctx.sessionManager.getBranch()),
    )
    pi.on('session_tree', (_event, ctx) =>
      restore(ctx.sessionManager.getBranch()),
    )

    pi.registerTool({
      name: 'todo',
      label: '工作清单',
      description:
        '管理当前会话的工作清单。需要三个及以上步骤的复杂任务应先建立清单，并在执行中按任务 ID 更新进度；简单问答无需清单。replace 重建完整清单；add 增加待处理任务；update 修改指定任务；list 查看当前清单。清单反映实际进度，不替代 Skill 的工作流状态。',
      promptSnippet:
        'Use todo for complex work with 3+ steps. Update progress by task ID; replace only when rebuilding the whole list.',
      parameters: Type.Object(
        {
          action: Type.Union([
            Type.Literal('replace'),
            Type.Literal('add'),
            Type.Literal('update'),
            Type.Literal('list'),
          ]),
          tasks: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  subject: Type.String({
                    minLength: 1,
                    maxLength: MAX_TEXT_LENGTH,
                  }),
                  status: Type.Union([
                    Type.Literal('pending'),
                    Type.Literal('in_progress'),
                    Type.Literal('completed'),
                  ]),
                  activeForm: Type.Optional(
                    Type.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
                  ),
                },
                { additionalProperties: false },
              ),
              { maxItems: MAX_TODOS },
            ),
          ),
          subject: Type.Optional(
            Type.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
          ),
          activeForm: Type.Optional(
            Type.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
          ),
          id: Type.Optional(Type.Integer({ minimum: 1 })),
          status: Type.Optional(
            Type.Union([
              Type.Literal('pending'),
              Type.Literal('in_progress'),
              Type.Literal('completed'),
            ]),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const input = params as TodoInput
        let tasks = state.tasks.map((task) => ({ ...task }))
        let nextId = state.nextId
        switch (input.action) {
          case 'replace': {
            validateFields(input, ['action', 'tasks'])
            if (!Array.isArray(input.tasks) || input.tasks.length > MAX_TODOS)
              throw new Error('任务清单无效或数量超限')
            tasks = input.tasks.map((item) => {
              if (!item || typeof item !== 'object')
                throw new Error('任务项无效')
              if (
                !Number.isSafeInteger(nextId) ||
                nextId >= Number.MAX_SAFE_INTEGER
              )
                throw new Error('任务 ID 已用尽')
              const task: AgentTodo = {
                id: nextId++,
                subject: validateText(item.subject, '任务标题'),
                status: validateStatus(item.status),
              }
              if (item.activeForm !== undefined)
                task.activeForm = validateText(item.activeForm, '进行中提示')
              return task
            })
            break
          }
          case 'add':
            validateFields(input, ['action', 'subject', 'activeForm'])
            if (tasks.length >= MAX_TODOS) throw new Error('任务数量已达上限')
            if (
              !Number.isSafeInteger(nextId) ||
              nextId >= Number.MAX_SAFE_INTEGER
            )
              throw new Error('任务 ID 已用尽')
            tasks.push({
              id: nextId++,
              subject: validateText(input.subject, '任务标题'),
              status: 'pending',
              ...(input.activeForm === undefined
                ? {}
                : { activeForm: validateText(input.activeForm, '进行中提示') }),
            })
            break
          case 'update': {
            validateFields(input, [
              'action',
              'id',
              'subject',
              'status',
              'activeForm',
            ])
            if (!Number.isSafeInteger(input.id) || !input.id || input.id <= 0)
              throw new Error('任务 ID 无效')
            if (
              input.subject === undefined &&
              input.status === undefined &&
              input.activeForm === undefined
            )
              throw new Error('至少提供一个待修改字段')
            const task = tasks.find((item) => item.id === input.id)
            if (!task) throw new Error(`任务不存在：${input.id}`)
            if (input.subject !== undefined)
              task.subject = validateText(input.subject, '任务标题')
            if (input.status !== undefined)
              task.status = validateStatus(input.status)
            if (input.activeForm !== undefined)
              task.activeForm = validateText(input.activeForm, '进行中提示')
            break
          }
          case 'list':
            validateFields(input, ['action'])
            break
          default:
            throw new Error('Todo 操作无效')
        }
        validateSingleActive(tasks)
        state = { version: 1, tasks, nextId }
        return {
          content: [
            {
              type: 'text' as const,
              text: tasks.length
                ? tasks
                    .map(
                      (task) => `#${task.id} [${task.status}] ${task.subject}`,
                    )
                    .join('\n')
                : '工作清单为空',
            },
          ],
          details: structuredClone(state),
        }
      },
    })
  }
}
