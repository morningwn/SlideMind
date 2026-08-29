import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { DEEPSEEK_PROVIDER_ID, type AgentPromptResult } from '../../shared/agent'
import type { AgentConfigStore, AgentConfiguration } from './config-store'

const SYSTEM_PROMPT = `你是 SlideMind 的基础演示创作 agent。
你的职责是帮助用户梳理材料、建立清晰叙事、规划演示结构并打磨表达。
信息不足时先指出缺口；不要虚构事实；输出应简洁、可执行。`

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

export class BaseAgentService {
  private agent?: Agent
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly configStore: AgentConfigStore) {}

  reset(): void {
    this.agent?.abort()
    this.agent = undefined
  }

  prompt(input: unknown): Promise<AgentPromptResult> {
    if (typeof input !== 'string' || !input.trim()) {
      return Promise.reject(new Error('请输入要交给 agent 的内容'))
    }

    if (input.length > 100_000) {
      return Promise.reject(new Error('输入内容长度超出限制'))
    }

    const run = this.queue.then(() => this.runPrompt(input.trim()))
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async createAgent(config: AgentConfiguration): Promise<Agent> {
    const { Agent: PiAgent, createModels, deepseekProvider } = await loadPiRuntime()
    const models = createModels()
    models.setProvider(deepseekProvider())
    const model = models.getModel(DEEPSEEK_PROVIDER_ID, config.modelId)

    if (!model) {
      throw new Error(`DeepSeek 模型不可用：${config.modelId}`)
    }

    return new PiAgent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        model,
        thinkingLevel: 'off',
        tools: [],
        messages: []
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: (provider) => (provider === DEEPSEEK_PROVIDER_ID ? config.apiKey : undefined)
    })
  }

  private async runPrompt(input: string): Promise<AgentPromptResult> {
    const config = await this.configStore.load()
    if (!config) {
      throw new Error('请先配置 DeepSeek 模型与 API Key')
    }

    const agent = (this.agent ??= await this.createAgent(config))
    await agent.prompt(input)

    if (agent.state.errorMessage) {
      throw new Error(agent.state.errorMessage)
    }

    const message = [...agent.state.messages].reverse().find(isAssistantMessage)
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
}
