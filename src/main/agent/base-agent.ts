import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AgentSession as PiAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { join } from 'node:path'
import {
  DEEPSEEK_PROVIDER_ID,
  type AgentPromptInput,
  type AgentPromptResult
} from '../../shared/agent'
import type { ProjectRootRegistry } from '../project/project-root-registry'
import {
  findPiSessionFile,
  resolvePiConversationsDirectory
} from '../project/project-storage'
import type { AgentConfigStore, AgentConfiguration } from './config-store'

const MAX_AGENT_SESSIONS = 50
const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const SYSTEM_PROMPT = `你是 SlideMind 的基础演示创作 agent。
你的职责是帮助用户梳理材料、建立清晰叙事、规划演示结构并打磨表达。
信息不足时先指出缺口；不要虚构事实；输出应简洁、可执行。`

interface AgentSessionRecord {
  agent?: PiAgentSession
  lastUsedAt: number
  queue: Promise<void>
}

interface PiRuntime {
  createAgentSession: typeof import('@earendil-works/pi-coding-agent').createAgentSession
  DefaultResourceLoader: typeof import('@earendil-works/pi-coding-agent').DefaultResourceLoader
  ModelRuntime: typeof import('@earendil-works/pi-coding-agent').ModelRuntime
  SessionManager: typeof import('@earendil-works/pi-coding-agent').SessionManager
}

let piRuntimePromise: Promise<PiRuntime> | undefined

async function loadPiRuntime(): Promise<PiRuntime> {
  piRuntimePromise ??= import('@earendil-works/pi-coding-agent').then((codingAgent) => ({
    createAgentSession: codingAgent.createAgentSession,
    DefaultResourceLoader: codingAgent.DefaultResourceLoader,
    ModelRuntime: codingAgent.ModelRuntime,
    SessionManager: codingAgent.SessionManager
  }))

  return piRuntimePromise
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === 'assistant'
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
  const projectHandle = typeof candidate.projectHandle === 'string'
    ? candidate.projectHandle.trim()
    : ''
  const prompt = typeof candidate.input === 'string' ? candidate.input.trim() : ''

  if (
    !requestId ||
    requestId.length > 200 ||
    !conversationId ||
    conversationId.length > 200 ||
    !SESSION_ID_PATTERN.test(conversationId)
  ) {
    throw new Error('Agent 会话标识无效')
  }

  if (!projectHandle || projectHandle.length > 200 || projectHandle.includes('\0')) {
    throw new Error('项目授权无效')
  }

  if (!prompt) {
    throw new Error('请输入要交给 agent 的内容')
  }

  if (prompt.length > 100_000) {
    throw new Error('输入内容长度超出限制')
  }

  return { requestId, conversationId, projectHandle, input: prompt }
}

export class BaseAgentService {
  private readonly sessions = new Map<string, AgentSessionRecord>()
  private modelRuntimePromise?: Promise<ModelRuntime>

  constructor(
    private readonly configStore: AgentConfigStore,
    private readonly projectRoots: ProjectRootRegistry,
    private readonly agentDirectory: string
  ) {}

  reset(): void {
    for (const session of this.sessions.values()) {
      if (session.agent) void session.agent.abort().finally(() => session.agent?.dispose())
    }
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

    let projectPath: string
    try {
      projectPath = this.projectRoots.resolve(prompt.projectHandle)
    } catch (error) {
      return Promise.reject(error)
    }

    const sessionKey = `${prompt.projectHandle}\0${prompt.conversationId}`
    let session = this.sessions.get(sessionKey)
    if (!session) {
      this.evictOldestSession()
      session = { lastUsedAt: Date.now(), queue: Promise.resolve() }
      this.sessions.set(sessionKey, session)
    }

    const run = session.queue.then(() => this.runPrompt(session, prompt, projectPath, onDelta))
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
    conversationId: string
  ): Promise<PiAgentSession> {
    const {
      createAgentSession,
      DefaultResourceLoader,
      SessionManager
    } = await loadPiRuntime()
    const modelRuntime = await this.getModelRuntime()
    await modelRuntime.setRuntimeApiKey(DEEPSEEK_PROVIDER_ID, config.apiKey)
    const model = modelRuntime.getModel(DEEPSEEK_PROVIDER_ID, config.modelId)

    if (!model) {
      throw new Error(`DeepSeek 模型不可用：${config.modelId}`)
    }

    const conversationsDirectory = await resolvePiConversationsDirectory(projectPath, true)
    if (!conversationsDirectory) throw new Error('无法创建 Pi 会话存储目录')

    const sessionPath = await findPiSessionFile(conversationsDirectory, conversationId)
    const sessionManager = sessionPath
      ? SessionManager.open(
          sessionPath,
          conversationsDirectory,
          projectPath
        )
      : SessionManager.create(projectPath, conversationsDirectory, { id: conversationId })
    if (sessionManager.getSessionId() !== conversationId) {
      throw new Error('Pi 会话记录标识不匹配')
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: projectPath,
      agentDir: this.agentDirectory,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: `${SYSTEM_PROMPT}\n\n当前对话所属项目目录（JSON 字符串）：${JSON.stringify(projectPath)}`
    })
    await resourceLoader.reload()

    const { session } = await createAgentSession({
      cwd: projectPath,
      agentDir: this.agentDirectory,
      modelRuntime,
      model,
      thinkingLevel: 'off',
      noTools: 'all',
      resourceLoader,
      sessionManager
    })
    return session
  }

  private async runPrompt(
    session: AgentSessionRecord,
    input: AgentPromptInput,
    projectPath: string,
    onDelta?: (input: AgentPromptInput, delta: string) => void
  ): Promise<AgentPromptResult> {
    const config = await this.configStore.load()
    if (!config) {
      throw new Error('请先配置 DeepSeek 模型与 API Key')
    }

    session.agent ??= await this.createAgent(
      config,
      projectPath,
      input.conversationId
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
    if (oldest[1].agent) {
      void oldest[1].agent.abort().finally(() => oldest[1].agent?.dispose())
    }
    this.sessions.delete(oldest[0])
  }

  private async getModelRuntime(): Promise<ModelRuntime> {
    if (!this.modelRuntimePromise) {
      this.modelRuntimePromise = loadPiRuntime().then(({ ModelRuntime }) => ModelRuntime.create({
        authPath: join(this.agentDirectory, 'auth.json'),
        modelsPath: null,
        refreshOnCreate: false
      }))
    }
    return this.modelRuntimePromise
  }
}
