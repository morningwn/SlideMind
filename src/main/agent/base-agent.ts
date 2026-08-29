import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { isAbsolute } from 'node:path'
import {
  DEEPSEEK_PROVIDER_ID,
  type AgentHistoryMessage,
  type AgentPromptInput,
  type AgentPromptResult
} from '../../shared/agent'
import type { AgentConfigStore, AgentConfiguration } from './config-store'

const MAX_AGENT_SESSIONS = 50
const MAX_HISTORY_MESSAGES = 10_000
const MAX_HISTORY_MESSAGE_LENGTH = 2_000_000
const SYSTEM_PROMPT = `你是 SlideMind 的基础演示创作 agent。
你的职责是帮助用户梳理材料、建立清晰叙事、规划演示结构并打磨表达。
信息不足时先指出缺口；不要虚构事实；输出应简洁、可执行。`

interface AgentSession {
  agent?: Agent
  lastUsedAt: number
  queue: Promise<void>
}

interface PiRuntime {
  Agent: typeof import('@earendil-works/pi-agent-core').Agent
  createModels: typeof import('@earendil-works/pi-ai').createModels
  deepseekProvider: typeof import('@earendil-works/pi-ai/providers/deepseek').deepseekProvider
}

let piRuntimePromise: Promise<PiRuntime> | undefined

async function loadPiRuntime(): Promise<PiRuntime> {
  piRuntimePromise ??= Promise.all([
    import('@earendil-works/pi-agent-core'),
    import('@earendil-works/pi-ai'),
    import('@earendil-works/pi-ai/providers/deepseek')
  ]).then(([agentCore, piAi, deepseek]) => ({
    Agent: agentCore.Agent,
    createModels: piAi.createModels,
    deepseekProvider: deepseek.deepseekProvider
  }))

  return piRuntimePromise
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === 'assistant'
}

function isAgentHistoryMessage(value: unknown): value is AgentHistoryMessage {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    (candidate.role === 'assistant' || candidate.role === 'user') &&
    typeof candidate.text === 'string' &&
    candidate.text.length <= MAX_HISTORY_MESSAGE_LENGTH
  )
}

export function normalizeAgentPromptInput(input: unknown): AgentPromptInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Agent 请求格式无效')
  }

  const candidate = input as Record<string, unknown>
  const requestId = typeof candidate.requestId === 'string' ? candidate.requestId.trim() : ''
  const conversationId = typeof candidate.conversationId === 'string'
    ? candidate.conversationId.trim()
    : ''
  const projectPath = typeof candidate.projectPath === 'string' ? candidate.projectPath.trim() : ''
  const prompt = typeof candidate.input === 'string' ? candidate.input.trim() : ''
  const history = candidate.history === undefined ? [] : candidate.history

  if (!requestId || requestId.length > 200 || !conversationId || conversationId.length > 200) {
    throw new Error('Agent 会话标识无效')
  }

  if (
    !projectPath ||
    projectPath.length > 4096 ||
    projectPath.includes('\0') ||
    !isAbsolute(projectPath)
  ) {
    throw new Error('项目路径无效')
  }

  if (!prompt) {
    throw new Error('请输入要交给 agent 的内容')
  }

  if (prompt.length > 100_000) {
    throw new Error('输入内容长度超出限制')
  }

  if (
    !Array.isArray(history) ||
    history.length > MAX_HISTORY_MESSAGES ||
    !history.every(isAgentHistoryMessage)
  ) {
    throw new Error('Agent 历史记录无效')
  }

  return { requestId, conversationId, projectPath, input: prompt, history }
}

export class BaseAgentService {
  private readonly sessions = new Map<string, AgentSession>()

  constructor(private readonly configStore: AgentConfigStore) {}

  reset(): void {
    for (const session of this.sessions.values()) session.agent?.abort()
    this.sessions.clear()
  }

  prompt(
    input: unknown,
    onDelta?: (input: AgentPromptInput, delta: string) => void
  ): Promise<AgentPromptResult> {
    let prompt: AgentPromptInput
    try {
      prompt = normalizeAgentPromptInput(input)
    } catch (error) {
      return Promise.reject(error)
    }

    const sessionKey = `${prompt.projectPath}\0${prompt.conversationId}`
    let session = this.sessions.get(sessionKey)
    if (!session) {
      this.evictOldestSession()
      session = { lastUsedAt: Date.now(), queue: Promise.resolve() }
      this.sessions.set(sessionKey, session)
    }

    const run = session.queue.then(() => this.runPrompt(session, prompt, onDelta))
    const queue = run.then(
      () => undefined,
      () => undefined
    )
    session.queue = queue
    return run
  }

  private async createAgent(
    config: AgentConfiguration,
    projectPath: string,
    conversationId: string,
    history: AgentHistoryMessage[]
  ): Promise<Agent> {
    const { Agent: PiAgent, createModels, deepseekProvider } = await loadPiRuntime()
    const models = createModels()
    models.setProvider(deepseekProvider())
    const model = models.getModel(DEEPSEEK_PROVIDER_ID, config.modelId)

    if (!model) {
      throw new Error(`DeepSeek 模型不可用：${config.modelId}`)
    }

    const timestamp = Date.now() - history.length
    const historyMessages: AgentMessage[] = history.map((message, index) => {
      if (message.role === 'user') {
        return { role: 'user', content: message.text, timestamp: timestamp + index }
      }

      return {
        role: 'assistant',
        content: [{ type: 'text', text: message.text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp: timestamp + index
      }
    })

    return new PiAgent({
      initialState: {
        systemPrompt: `${SYSTEM_PROMPT}\n\n当前对话所属项目目录（JSON 字符串）：${JSON.stringify(projectPath)}`,
        model,
        thinkingLevel: 'off',
        tools: [],
        messages: historyMessages
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: (provider) => (provider === DEEPSEEK_PROVIDER_ID ? config.apiKey : undefined),
      sessionId: conversationId
    })
  }

  private async runPrompt(
    session: AgentSession,
    input: AgentPromptInput,
    onDelta?: (input: AgentPromptInput, delta: string) => void
  ): Promise<AgentPromptResult> {
    const config = await this.configStore.load()
    if (!config) {
      throw new Error('请先配置 DeepSeek 模型与 API Key')
    }

    session.agent ??= await this.createAgent(
      config,
      input.projectPath,
      input.conversationId,
      input.history
    )
    session.lastUsedAt = Date.now()
    const unsubscribe = session.agent.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        onDelta?.(input, event.assistantMessageEvent.delta)
      }
    })

    try {
      await session.agent.prompt(input.input)
    } finally {
      unsubscribe()
    }

    if (session.agent.state.errorMessage) {
      throw new Error(session.agent.state.errorMessage)
    }

    const message = [...session.agent.state.messages].reverse().find(isAssistantMessage)
    if (!message) {
      throw new Error('agent 未返回内容')
    }

    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    return { text, modelId: config.modelId }
  }

  private evictOldestSession(): void {
    if (this.sessions.size < MAX_AGENT_SESSIONS) return

    const oldest = [...this.sessions.entries()].reduce((candidate, entry) =>
      entry[1].lastUsedAt < candidate[1].lastUsedAt ? entry : candidate
    )
    oldest[1].agent?.abort()
    this.sessions.delete(oldest[0])
  }
}
