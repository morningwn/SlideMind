export const DEEPSEEK_PROVIDER_ID = 'deepseek' as const

export const DEEPSEEK_MODEL_OPTIONS = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: '响应更快，适合日常构思与大纲整理'
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: '推理能力更强，适合复杂叙事与内容打磨'
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

export interface AgentApi {
  getConfig(): Promise<AgentConfigStatus>
  saveConfig(input: SaveAgentConfigInput): Promise<AgentConfigStatus>
  prompt(input: string): Promise<AgentPromptResult>
}

