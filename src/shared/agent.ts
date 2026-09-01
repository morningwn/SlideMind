export const DEEPSEEK_PROVIDER_ID = 'deepseek' as const

export const AGENT_THINKING_LEVEL_OPTIONS = [
  {
    id: 'off',
    name: '关闭',
    description: '不启用额外推理，响应最快'
  },
  {
    id: 'low',
    name: '轻量',
    description: '少量推理，适合简单问题'
  },
  {
    id: 'high',
    name: '深入',
    description: '充分推理，适合大多数创作任务'
  },
  {
    id: 'max',
    name: '极致',
    description: '使用最大推理深度，适合复杂任务'
  }
] as const

export type AgentThinkingLevel = typeof AGENT_THINKING_LEVEL_OPTIONS[number]['id']

export const DEFAULT_AGENT_THINKING_LEVEL: AgentThinkingLevel = 'high'

export function isAgentThinkingLevel(value: unknown): value is AgentThinkingLevel {
  return AGENT_THINKING_LEVEL_OPTIONS.some((option) => option.id === value)
}

export const DEEPSEEK_MODEL_OPTIONS = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: '响应更快，适合日常构思与大纲整理',
    thinkingLevels: ['off', 'low', 'high', 'max'] satisfies AgentThinkingLevel[]
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: '推理能力更强，适合复杂叙事与内容打磨',
    thinkingLevels: ['off', 'high', 'max'] satisfies AgentThinkingLevel[]
  }
] as const

export const DEFAULT_DEEPSEEK_MODEL_ID = DEEPSEEK_MODEL_OPTIONS[0].id

export interface AgentConfigStatus {
  configured: boolean
  provider: typeof DEEPSEEK_PROVIDER_ID
  providerName: 'DeepSeek'
  modelId: string
  modelName: string
  models: ReadonlyArray<{
    id: string
    name: string
    description: string
    thinkingLevels: ReadonlyArray<AgentThinkingLevel>
  }>
}

export interface SaveAgentConfigInput {
  modelId: string
  apiKey: string
}

export interface AgentPromptResult {
  text: string
  modelId: string
}

export interface AgentFileReference {
  type: 'file'
  path: string
}

export interface AgentSkillReference {
  type: 'skill'
  name: string
}

export type AgentPromptReference = AgentFileReference | AgentSkillReference

export interface AgentSkillOption {
  name: string
  description: string
}

export interface AgentPromptInput {
  requestId: string
  conversationId: string
  projectHandle: string
  input: string
  references: AgentPromptReference[]
  thinkingLevel: AgentThinkingLevel
}

export interface AgentConversationInput {
  conversationId: string
  projectHandle: string
}

export interface AgentConversationUsage {
  totalTokens: number
  contextTokens: number | null
  contextWindow: number | null
  contextPercent: number | null
}

export interface AgentStopInput extends AgentConversationInput {
  requestId: string
}

export interface AgentStopResult {
  stopped: boolean
}

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentTodo {
  id: number
  subject: string
  activeForm?: string
  status: AgentTodoStatus
  blockedBy?: number[]
}

export interface AgentStreamEvent {
  requestId: string
  conversationId: string
  delta: string
}

export interface AgentTodosEvent {
  requestId: string
  conversationId: string
  todos: AgentTodo[]
}

export type AgentActivityKind = 'thinking' | 'skill' | 'tool'
export type AgentActivityStatus = 'running' | 'completed' | 'stopped' | 'error'

export interface AgentActivity {
  id: string
  kind: AgentActivityKind
  name: string
  status: AgentActivityStatus
  content?: string
  detail?: string
}

export type AgentActivityEvent = {
  requestId: string
  conversationId: string
} & (
  | { type: 'start'; activity: AgentActivity }
  | { type: 'append'; activityId: string; delta: string }
  | { type: 'finish'; activityId: string; status: Exclude<AgentActivityStatus, 'running'>; detail?: string }
)

export interface AgentApi {
  getConfig(): Promise<AgentConfigStatus>
  saveConfig(input: SaveAgentConfigInput): Promise<AgentConfigStatus>
  listSkills(projectHandle: string): Promise<AgentSkillOption[]>
  getTodos(input: AgentConversationInput): Promise<AgentTodo[]>
  getUsage(input: AgentConversationInput): Promise<AgentConversationUsage>
  prompt(input: AgentPromptInput): Promise<AgentPromptResult>
  stop(input: AgentStopInput): Promise<AgentStopResult>
  onStream(listener: (event: AgentStreamEvent) => void): () => void
  onTodos(listener: (event: AgentTodosEvent) => void): () => void
  onActivity(listener: (event: AgentActivityEvent) => void): () => void
}
