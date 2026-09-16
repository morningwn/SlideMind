import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from '@earendil-works/pi-coding-agent'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTodoToolsExtension } from './todo-tools'
import { snapshotFromSessionEntries, todosFromToolResult } from './agent-todo'

type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0]

async function harness(
  onRestore?: (tasks: ReturnType<typeof todosFromToolResult>) => void,
) {
  let tool: RegisteredTool | undefined
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const api = {
    registerTool: (definition: RegisteredTool) => {
      tool = definition
    },
    on: (event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler)
    },
  } as unknown as ExtensionAPI
  await createTodoToolsExtension(
    onRestore as Parameters<typeof createTodoToolsExtension>[0],
  )(api)
  if (!tool) throw new Error('todo tool was not registered')
  const registered = tool
  const execute = (params: Record<string, unknown>) =>
    registered.execute('test', params, undefined, undefined, undefined as never)
  const restore = (
    event: 'session_start' | 'session_tree',
    entries: unknown[],
  ) => {
    const handler = handlers.get(event)
    if (!handler) throw new Error(`missing ${event} handler`)
    handler(
      { type: event } as never,
      {
        sessionManager: { getBranch: () => entries },
      } as unknown as ExtensionContext as never,
    )
  }
  return { execute, restore }
}

function entry(details: unknown) {
  return {
    type: 'message',
    message: { role: 'toolResult', toolName: 'todo', details },
  }
}

describe('local todo tool', () => {
  it('loads a persisted legacy snapshot through Pi startup and reload', async () => {
    const {
      createAgentSession,
      DefaultResourceLoader,
      ModelRuntime,
      SessionManager,
    } = await import('@earendil-works/pi-coding-agent')
    const root = join(tmpdir(), `slidemind-todo-${crypto.randomUUID()}`)
    const agentDir = join(root, 'agent')
    await mkdir(agentDir, { recursive: true })
    const manager = SessionManager.inMemory(root)
    manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'old-todo',
      toolName: 'todo',
      content: [{ type: 'text', text: '旧任务' }],
      details: {
        tasks: [{ id: 4, subject: '旧任务', status: 'pending' }],
        nextId: 5,
      },
    } as Parameters<typeof manager.appendMessage>[0])
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false,
    })
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: 'slidemind-todo',
          factory: createTodoToolsExtension(undefined, () =>
            manager.getBranch(),
          ),
        },
      ],
    })
    await loader.reload()
    const { session } = await createAgentSession({
      cwd: root,
      agentDir,
      modelRuntime: runtime,
      model: runtime.getModels()[0],
      tools: ['todo'],
      resourceLoader: loader,
      sessionManager: manager,
    })
    try {
      const todo = session.getToolDefinition('todo')
      expect(todo).toBeDefined()
      expect(
        todosFromToolResult(
          await todo!.execute(
            'list',
            { action: 'list' },
            undefined,
            undefined,
            session.extensionRunner.createContext(),
          ),
        ),
      ).toEqual([{ id: 4, subject: '旧任务', status: 'pending' }])
      await session.reload()
      const reloaded = session.getToolDefinition('todo')
      expect(
        todosFromToolResult(
          await reloaded!.execute(
            'add',
            { action: 'add', subject: '新任务' },
            undefined,
            undefined,
            session.extensionRunner.createContext(),
          ),
        )?.[1].id,
      ).toBe(5)
    } finally {
      session.dispose()
    }
  })

  it('replaces, adds, updates, lists, reopens, and clears with monotonic IDs', async () => {
    const { execute } = await harness()
    const replaced = await execute({
      action: 'replace',
      tasks: [
        { subject: '准备资料', status: 'in_progress' },
        { subject: '排版', status: 'pending' },
      ],
    })
    expect(replaced.details).toMatchObject({ version: 1, nextId: 3 })
    const added = await execute({ action: 'add', subject: '检查' })
    expect(todosFromToolResult(added)).toHaveLength(3)
    await execute({ action: 'update', id: 1, status: 'completed' })
    await execute({
      action: 'update',
      id: 2,
      status: 'in_progress',
      activeForm: '正在排版',
    })
    expect(
      todosFromToolResult(await execute({ action: 'list' })),
    ).toMatchObject([
      { id: 1, status: 'completed' },
      { id: 2, status: 'in_progress', activeForm: '正在排版' },
      { id: 3, status: 'pending' },
    ])
    await execute({ action: 'update', id: 2, status: 'completed' })
    expect(
      todosFromToolResult(
        await execute({ action: 'update', id: 1, status: 'pending' }),
      )?.[0].status,
    ).toBe('pending')
    const cleared = await execute({ action: 'replace', tasks: [] })
    expect(cleared.details).toEqual({ version: 1, tasks: [], nextId: 4 })
    expect(
      todosFromToolResult(
        await execute({ action: 'add', subject: '返工' }),
      )?.[0].id,
    ).toBe(4)
  })

  it('rejects invalid changes without altering the snapshot', async () => {
    const { execute } = await harness()
    await execute({ action: 'add', subject: '第一项' })
    await execute({ action: 'update', id: 1, status: 'in_progress' })
    const before = (await execute({ action: 'list' })).details
    await expect(execute({ action: 'add', subject: ' ' })).rejects.toThrow()
    await expect(
      execute({ action: 'update', id: 9, status: 'completed' }),
    ).rejects.toThrow()
    await expect(execute({ action: 'update', id: 1 })).rejects.toThrow()
    await expect(
      execute({ action: 'add', subject: '第二项', status: 'invalid' }),
    ).rejects.toThrow()
    await execute({ action: 'add', subject: '第二项' })
    await expect(
      execute({ action: 'update', id: 2, status: 'in_progress' }),
    ).rejects.toThrow()
    expect((await execute({ action: 'list' })).details).toMatchObject({
      tasks: [
        ...(before as { tasks: unknown[] }).tasks,
        { id: 2, subject: '第二项', status: 'pending' },
      ],
      nextId: 3,
    })
  })

  it('restores old and new snapshots on startup and branch changes', async () => {
    const onRestore = vi.fn()
    const { execute, restore } = await harness(onRestore)
    const legacy = entry({
      tasks: [
        { id: 7, subject: '旧任务', status: 'pending', blockedBy: [2] },
        { id: 8, subject: '已删除', status: 'deleted' },
      ],
      nextId: 9,
    })
    restore('session_start', [legacy])
    expect(onRestore).toHaveBeenLastCalledWith([
      { id: 7, subject: '旧任务', status: 'pending' },
    ])
    expect(
      todosFromToolResult(
        await execute({ action: 'add', subject: '新任务' }),
      )?.[1].id,
    ).toBe(9)
    const later = entry({
      version: 1,
      tasks: [{ id: 20, subject: '分支任务', status: 'completed' }],
      nextId: 21,
    })
    restore('session_tree', [legacy, later])
    expect(todosFromToolResult(await execute({ action: 'list' }))).toEqual([
      { id: 20, subject: '分支任务', status: 'completed' },
    ])
    restore('session_tree', [legacy])
    expect(todosFromToolResult(await execute({ action: 'list' }))?.[0].id).toBe(
      7,
    )
    restore('session_start', [legacy, { type: 'compaction' }, later])
    expect((await execute({ action: 'list' })).details).toMatchObject({
      nextId: 21,
    })
    expect(
      snapshotFromSessionEntries([legacy, entry({ version: 3, tasks: [] })])
        .tasks[0].id,
    ).toBe(7)
  })

  it('keeps session instances isolated', async () => {
    const first = await harness()
    const second = await harness()
    await first.execute({ action: 'add', subject: '仅会话一' })
    expect(
      todosFromToolResult(await second.execute({ action: 'list' })),
    ).toEqual([])
  })
})
