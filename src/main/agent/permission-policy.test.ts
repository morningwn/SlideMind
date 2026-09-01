import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { todosFromToolResult } from './agent-todo'
import {
  createManagedPermissionPolicy,
  preparePermissionSystem
} from './permission-policy'

const require = createRequire(import.meta.url)
const todoExtensionPath = join(
  dirname(require.resolve('@juicesharp/rpiv-todo/package.json')),
  'index.ts'
)

describe('createManagedPermissionPolicy', () => {
  it('allows project file tools while denying unknown tools and bash', () => {
    const policy = createManagedPermissionPolicy('/tmp/slidemind-agent') as {
      tools: Record<string, string>
      bash: Record<string, string>
      defaultPolicy: Record<string, string>
    }

    expect(policy.defaultPolicy.tools).toBe('deny')
    expect(policy.tools).toMatchObject({
      '*': 'deny',
      read: 'allow',
      write: 'allow',
      edit: 'allow',
      grep: 'allow',
      find: 'allow',
      ls: 'allow',
      todo: 'allow',
      pptx_read: 'allow',
      template_query: 'allow',
      web_search: 'allow',
      source_check: 'allow',
      fetch_content: 'allow',
      get_search_content: 'allow',
      download_asset: 'allow'
    })
    expect(policy.bash['*']).toBe('deny')
  })

  it('allows reading the managed skills directory but denies mutations there', () => {
    const agentDirectory = '/tmp/slidemind-agent'
    const skillsDirectory = join(agentDirectory, 'skills')
    const bundledSkillsDirectory = '/app/resources/skills'
    const policy = createManagedPermissionPolicy(agentDirectory, [bundledSkillsDirectory]) as {
      tools: Record<string, string>
      skills: Record<string, string>
      special: Record<string, string>
    }

    expect(policy.skills['*']).toBe('allow')
    expect(policy.special.external_directory).toBe('deny')
    expect(policy.special[`external_directory:${skillsDirectory}/*`]).toBe('allow')
    expect(policy.tools[`write:${skillsDirectory}/*`]).toBe('deny')
    expect(policy.tools[`edit:${skillsDirectory}/*`]).toBe('deny')
    expect(policy.special[`external_directory:${bundledSkillsDirectory}/*`]).toBe('allow')
    expect(policy.tools[`write:${bundledSkillsDirectory}/*`]).toBe('deny')
    expect(policy.tools[`edit:${bundledSkillsDirectory}/*`]).toBe('deny')
  })
})

describe('preparePermissionSystem', () => {
  it('writes an application-managed policy and disables yolo mode', async () => {
    const agentDirectory = join('/tmp', `slidemind-permissions-${crypto.randomUUID()}`)
    const setup = await preparePermissionSystem(agentDirectory)
    const policy = JSON.parse(await readFile(setup.policyPath, 'utf8')) as {
      defaultPolicy: Record<string, string>
    }
    const config = JSON.parse(await readFile(
      join(agentDirectory, 'permission-system', 'config.json'),
      'utf8'
    )) as Record<string, unknown>

    expect(setup.extensionPath).toMatch(/pi-permission-system[/\\]index\.ts$/)
    expect(policy.defaultPolicy).toMatchObject({
      tools: 'deny',
      bash: 'deny',
      mcp: 'deny',
      special: 'deny'
    })
    expect(config).toMatchObject({
      enabled: true,
      debug: false,
      yoloMode: false
    })
  })

  it('blocks project-external file calls and skill mutations with Pi 0.84', async () => {
    const testDirectory = join('/tmp', `slidemind-permissions-${crypto.randomUUID()}`)
    const agentDirectory = join(testDirectory, 'agent')
    const projectDirectory = join(testDirectory, 'project')
    const skillsDirectory = join(agentDirectory, 'skills')
    await Promise.all([
      mkdir(projectDirectory, { recursive: true }),
      mkdir(skillsDirectory, { recursive: true })
    ])
    const setup = await preparePermissionSystem(agentDirectory)
    const {
      createAgentSession,
      DefaultResourceLoader,
      ModelRuntime,
      SessionManager
    } = await import('@earendil-works/pi-coding-agent')
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDirectory, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false
    })
    const model = modelRuntime.getModels()[0]
    expect(model).toBeDefined()

    const resourceLoader = new DefaultResourceLoader({
      cwd: projectDirectory,
      agentDir: agentDirectory,
      additionalExtensionPaths: [setup.extensionPath, todoExtensionPath],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true
    })
    await resourceLoader.reload()
    expect(resourceLoader.getExtensions()).toMatchObject({
      errors: [],
      extensions: [{}, {}]
    })
    const { session } = await createAgentSession({
      cwd: projectDirectory,
      agentDir: agentDirectory,
      modelRuntime,
      model,
      tools: ['read', 'write', 'edit', 'grep', 'find', 'ls', 'todo'],
      resourceLoader,
      sessionManager: SessionManager.inMemory(projectDirectory)
    })

    try {
      expect(session.getActiveToolNames()).toContain('todo')
      expect(session.systemPrompt).toContain('Use `todo` for complex work with 3+ steps')
      const todoTool = session.getToolDefinition('todo')
      expect(todoTool).toBeDefined()
      const todoResult = await todoTool!.execute(
        'create-todo',
        { action: 'create', subject: '梳理演示结构' },
        undefined,
        undefined,
        session.extensionRunner.createContext()
      )
      expect(todosFromToolResult(todoResult)).toEqual([
        { id: 1, subject: '梳理演示结构', status: 'pending' }
      ])

      const insideRead = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'inside-read',
        toolName: 'read',
        input: { path: join(projectDirectory, 'notes.md') }
      })
      const outsideRead = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'outside-read',
        toolName: 'read',
        input: { path: join(testDirectory, 'outside.md') }
      })
      const skillRead = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'skill-read',
        toolName: 'read',
        input: { path: join(skillsDirectory, 'demo', 'SKILL.md') }
      })
      const skillWrite = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'skill-write',
        toolName: 'write',
        input: { path: join(skillsDirectory, 'demo', 'SKILL.md'), content: 'changed' }
      })

      expect(insideRead?.block).not.toBe(true)
      expect(outsideRead?.block).toBe(true)
      expect(skillRead?.block).not.toBe(true)
      expect(skillWrite?.block).toBe(true)
    } finally {
      session.dispose()
    }
  })
})
