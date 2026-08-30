import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AgentSession as PiAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  DEEPSEEK_PROVIDER_ID,
  type AgentConversationInput,
  type AgentPromptInput,
  type AgentPromptResult,
  type AgentTodo
} from '../../shared/agent'
import type { ProjectRootRegistry } from '../project/project-root-registry'
import type { PresentationService } from '../presentation/presentation-service'
import {
  findPiSessionFile,
  resolvePiConversationsDirectory
} from '../project/project-storage'
import type { AgentConfigStore, AgentConfiguration } from './config-store'
import { todosFromSessionEntries, todosFromToolResult } from './agent-todo'
import { preparePermissionSystem, type PermissionSystemSetup } from './permission-policy'
import { createPresentationToolsExtension } from './presentation-tools'

const require = createRequire(import.meta.url)
const MAX_AGENT_SESSIONS = 50
const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const TODO_EXTENSION_PATH = join(
  dirname(require.resolve('@juicesharp/rpiv-todo/package.json')),
  'index.ts'
)
const SYSTEM_PROMPT = `你是 SlideMind 的基础演示创作 agent。
你的职责是帮助用户梳理材料、建立清晰叙事、规划演示结构并打磨表达。
信息不足时先指出缺口；不要虚构事实；输出应简洁、可执行。`

interface AgentSessionRecord {
  agent?: PiAgentSession
  lastUsedAt: number
  queue: Promise<void>
  todos?: AgentTodo[]
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

export function normalizeAgentConversationInput(input: unknown): AgentConversationInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Agent 会话请求格式无效')
  }

  const candidate = input as Record<string, unknown>
  const conversationId = typeof candidate.conversationId === 'string'
    ? candidate.conversationId.trim()
    : ''
  const projectHandle = typeof candidate.projectHandle === 'string'
    ? candidate.projectHandle.trim()
    : ''

  if (
    !conversationId ||
    conversationId.length > 200 ||
    !SESSION_ID_PATTERN.test(conversationId)
  ) {
    throw new Error('Agent 会话标识无效')
  }
  if (!projectHandle || projectHandle.length > 200 || projectHandle.includes('\0')) {
    throw new Error('项目授权无效')
  }
  return { conversationId, projectHandle }
}

export function normalizeAgentPromptInput(input: unknown): AgentPromptInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Agent 请求格式无效')
  }

  const candidate = input as Record<string, unknown>
  const requestId = typeof candidate.requestId === 'string' ? candidate.requestId.trim() : ''
  const { conversationId, projectHandle } = normalizeAgentConversationInput(candidate)
  const prompt = typeof candidate.input === 'string' ? candidate.input.trim() : ''

  if (!requestId || requestId.length > 200) {
    throw new Error('Agent 会话标识无效')
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
  private permissionSystemPromise?: Promise<PermissionSystemSetup>

  constructor(
    private readonly configStore: AgentConfigStore,
    private readonly projectRoots: ProjectRootRegistry,
    private readonly agentDirectory: string,
    private readonly presentationService: PresentationService
  ) {}

  reset(): void {
    for (const session of this.sessions.values()) {
      if (session.agent) void session.agent.abort().finally(() => session.agent?.dispose())
    }
    this.sessions.clear()
  }

  async getTodos(input: unknown): Promise<AgentTodo[]> {
    const conversation = normalizeAgentConversationInput(input)
    const projectPath = this.projectRoots.resolve(conversation.projectHandle)
    const sessionKey = this.sessionKey(conversation)
    const activeTodos = this.sessions.get(sessionKey)?.todos
    if (activeTodos) return structuredClone(activeTodos)

    const conversationsDirectory = await resolvePiConversationsDirectory(projectPath, false)
    if (!conversationsDirectory) return []

    const { SessionManager } = await loadPiRuntime()
    const sessionPath = await findPiSessionFile(conversationsDirectory, conversation.conversationId)
    if (!sessionPath) return []
    const sessionManager = SessionManager.open(sessionPath, conversationsDirectory, projectPath)
    if (sessionManager.getSessionId() !== conversation.conversationId) {
      throw new Error('Pi 会话记录标识不匹配')
    }
    return todosFromSessionEntries(sessionManager.getBranch())
  }

  prompt(
    input: unknown,
    onDelta?: (input: AgentPromptInput, delta: string) => void,
    onTodos?: (input: AgentPromptInput, todos: AgentTodo[]) => void
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

    const sessionKey = this.sessionKey(prompt)
    let session = this.sessions.get(sessionKey)
    if (!session) {
      this.evictOldestSession()
      session = { lastUsedAt: Date.now(), queue: Promise.resolve() }
      this.sessions.set(sessionKey, session)
    }

    const run = session.queue.then(() => this.runPrompt(
      session,
      prompt,
      projectPath,
      onDelta,
      onTodos
    ))
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
    projectHandle: string,
    conversationId: string
  ): Promise<{ agent: PiAgentSession; todos: AgentTodo[] }> {
    const {
      createAgentSession,
      DefaultResourceLoader,
      SessionManager
    } = await loadPiRuntime()
    const modelRuntime = await this.getModelRuntime()
    const permissionSystem = await this.getPermissionSystem()
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
    const todos = todosFromSessionEntries(sessionManager.getBranch())

    const resourceLoader = new DefaultResourceLoader({
      cwd: projectPath,
      agentDir: this.agentDirectory,
      additionalExtensionPaths: [permissionSystem.extensionPath, TODO_EXTENSION_PATH],
      extensionFactories: [{
        name: 'slidemind-presentations',
        factory: createPresentationToolsExtension({
          presentationService: this.presentationService,
          projectHandle,
          projectPath
        })
      }],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: `${SYSTEM_PROMPT}\n\n当前对话所属项目目录（JSON 字符串）：${JSON.stringify(projectPath)}`
    })
    await resourceLoader.reload()
    const extensions = resourceLoader.getExtensions()
    if (extensions.errors.length > 0 || extensions.extensions.length !== 3) {
      const details = extensions.errors.map((entry) => entry.error).join('; ')
      throw new Error(`Agent 扩展加载失败${details ? `：${details}` : ''}`)
    }

    const { session } = await createAgentSession({
      cwd: projectPath,
      agentDir: this.agentDirectory,
      modelRuntime,
      model,
      thinkingLevel: 'off',
      tools: [
        'read',
        'write',
        'edit',
        'grep',
        'find',
        'ls',
        'todo',
        'slides_create',
        'slides_read',
        'slides_write',
        'slides_export'
      ],
      resourceLoader,
      sessionManager
    })
    return { agent: session, todos }
  }

  private async runPrompt(
    session: AgentSessionRecord,
    input: AgentPromptInput,
    projectPath: string,
    onDelta?: (input: AgentPromptInput, delta: string) => void,
    onTodos?: (input: AgentPromptInput, todos: AgentTodo[]) => void
  ): Promise<AgentPromptResult> {
    const config = await this.configStore.load()
    if (!config) {
      throw new Error('请先配置 DeepSeek 模型与 API Key')
    }

    if (!session.agent) {
      const created = await this.createAgent(
        config,
        projectPath,
        input.projectHandle,
        input.conversationId
      )
      session.agent = created.agent
      session.todos = created.todos
      onTodos?.(input, structuredClone(created.todos))
    }
    session.lastUsedAt = Date.now()
    const unsubscribe = session.agent.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        onDelta?.(input, event.assistantMessageEvent.delta)
      }
      if (event.type === 'tool_execution_end' && event.toolName === 'todo' && !event.isError) {
        const todos = todosFromToolResult(event.result)
        if (!todos) return
        session.todos = todos
        onTodos?.(input, structuredClone(todos))
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

  private sessionKey(input: AgentConversationInput): string {
    return `${input.projectHandle}\0${input.conversationId}`
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

  private getPermissionSystem(): Promise<PermissionSystemSetup> {
    this.permissionSystemPromise ??= preparePermissionSystem(this.agentDirectory)
    return this.permissionSystemPromise
  }
}
