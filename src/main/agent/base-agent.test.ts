import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createBlankPresentationDocument } from '../presentation/presentation-store'
import {
  BaseAgentService,
  normalizeAgentConversationInput,
  normalizeAgentPromptInput,
  normalizeAgentStopInput,
} from './base-agent'

describe('normalizeAgentConversationInput', () => {
  it('normalizes a project conversation reference', () => {
    expect(
      normalizeAgentConversationInput({
        conversationId: ' conversation-1 ',
        projectHandle: ' project-handle-1 ',
      }),
    ).toEqual({
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
    })
  })

  it('rejects invalid conversation references', () => {
    expect(() =>
      normalizeAgentConversationInput({
        conversationId: '../conversation-1',
        projectHandle: 'project-handle-1',
      }),
    ).toThrow('Agent 会话标识无效')
  })
})

describe('normalizeAgentPromptInput', () => {
  it('normalizes a project conversation prompt', () => {
    expect(
      normalizeAgentPromptInput({
        requestId: ' request-1 ',
        conversationId: ' conversation-1 ',
        projectHandle: ' project-handle-1 ',
        input: ' 建立一份产品发布演示 ',
        thinkingLevel: 'max',
        references: [
          { type: 'file', path: ' docs/brief.md ' },
          { type: 'skill', name: 'presentation-design' },
          { type: 'file', path: 'docs/brief.md' },
        ],
      }),
    ).toEqual({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
      input: '建立一份产品发布演示',
      thinkingLevel: 'max',
      references: [
        { type: 'file', path: 'docs/brief.md' },
        { type: 'skill', name: 'presentation-design' },
      ],
    })
  })

  it('defaults and validates the thinking level', () => {
    const baseInput = {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
      input: 'hello',
    }

    expect(normalizeAgentPromptInput(baseInput).thinkingLevel).toBe('high')
    expect(() =>
      normalizeAgentPromptInput({ ...baseInput, thinkingLevel: 'ultra' }),
    ).toThrow('Agent 思考深度无效')
  })

  it('rejects missing session identifiers', () => {
    expect(() =>
      normalizeAgentPromptInput({
        requestId: '',
        conversationId: 'conversation-1',
        projectHandle: 'project-handle-1',
        input: 'hello',
      }),
    ).toThrow('Agent 会话标识无效')

    expect(() =>
      normalizeAgentPromptInput({
        requestId: 'request-1',
        conversationId: '../conversation-1',
        projectHandle: 'project-handle-1',
        input: 'hello',
      }),
    ).toThrow('Agent 会话标识无效')
  })

  it('rejects invalid project handles', () => {
    expect(() =>
      normalizeAgentPromptInput({
        requestId: 'request-1',
        conversationId: 'conversation-1',
        projectHandle: 'project-handle\0hidden',
        input: 'hello',
      }),
    ).toThrow('项目授权无效')

    expect(() =>
      normalizeAgentPromptInput({
        requestId: 'request-1',
        conversationId: 'conversation-1',
        input: 'hello',
      }),
    ).toThrow('项目授权无效')
  })

  it('rejects empty and oversized prompts', () => {
    const baseInput = {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
    }

    expect(() =>
      normalizeAgentPromptInput({ ...baseInput, input: '   ' }),
    ).toThrow('请输入要交给 agent 的内容')
    expect(() =>
      normalizeAgentPromptInput({ ...baseInput, input: 'a'.repeat(100_001) }),
    ).toThrow('输入内容长度超出限制')
  })

  it('rejects malformed prompt references', () => {
    const baseInput = {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
      input: 'hello',
    }

    expect(() =>
      normalizeAgentPromptInput({
        ...baseInput,
        references: [{ type: 'file', path: '../\0secret' }],
      }),
    ).toThrow('Agent 文件引用无效')
    expect(() =>
      normalizeAgentPromptInput({
        ...baseInput,
        references: [{ type: 'skill', name: '../secret' }],
      }),
    ).toThrow('Agent skill 引用无效')
    expect(() =>
      normalizeAgentPromptInput({
        ...baseInput,
        references: Array.from({ length: 21 }, (_, index) => ({
          type: 'file',
          path: `${index}.md`,
        })),
      }),
    ).toThrow('Agent 引用格式无效')
  })
})

describe('normalizeAgentStopInput', () => {
  it('normalizes the exact request to stop', () => {
    expect(
      normalizeAgentStopInput({
        requestId: ' request-1 ',
        conversationId: ' conversation-1 ',
        projectHandle: ' project-handle-1 ',
      }),
    ).toEqual({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
    })
  })

  it('rejects an invalid request identifier', () => {
    expect(() =>
      normalizeAgentStopInput({
        requestId: ' ',
        conversationId: 'conversation-1',
        projectHandle: 'project-handle-1',
      }),
    ).toThrow('Agent 请求标识无效')
  })
})

describe('BaseAgentService.stop', () => {
  it('aborts only the matching active request', async () => {
    const abort = vi.fn(async () => {})
    const service = new BaseAgentService(
      {} as never,
      { resolve: vi.fn(() => '/project') } as never,
      '/agent',
      '/skills',
      {} as never,
      {} as never,
      {} as never,
    )
    const session = {
      agent: { abort },
      activeRequestId: 'request-1',
      queue: Promise.resolve(),
      requestIds: new Set(['request-1']),
      stoppedRequestIds: new Set<string>(),
    }
    const internal = service as unknown as { sessions: Map<string, unknown> }
    internal.sessions.set('project-handle-1\0conversation-1', session)

    await expect(
      service.stop({
        requestId: 'request-1',
        conversationId: 'conversation-1',
        projectHandle: 'project-handle-1',
      }),
    ).resolves.toEqual({ stopped: true })
    expect(abort).toHaveBeenCalledOnce()
    expect(session.stoppedRequestIds).toContain('request-1')

    await expect(
      service.stop({
        requestId: 'request-2',
        conversationId: 'conversation-1',
        projectHandle: 'project-handle-1',
      }),
    ).resolves.toEqual({ stopped: false })
    expect(abort).toHaveBeenCalledOnce()
  })
})

describe('BaseAgentService final response', () => {
  it.each([
    { content: [] },
    { content: [{ type: 'thinking', thinking: '继续制作演示' }] },
    { content: [{ type: 'text', text: '  \n ' }] },
  ])(
    'rejects an empty final response and allows the conversation to continue: %j',
    async ({ content }) => {
      const service = new BaseAgentService(
        {
          load: async () => ({ modelId: 'deepseek-flash', apiKey: 'fake' }),
        } as never,
        { resolve: () => '/project' } as never,
        '/agent',
        '/skills',
        {} as never,
        {} as never,
        {} as never,
      )
      const unsubscribe = vi.fn()
      const agent = {
        prompt: vi.fn(async () => {}),
        setThinkingLevel: vi.fn(),
        subscribe: vi.fn(() => unsubscribe),
        state: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: '上轮已完成' }],
            },
            { role: 'assistant', content },
          ],
        },
      }
      const createAgent = vi.fn(async () => ({ agent, todos: [] }))
      Object.assign(service, { createAgent })
      const input = {
        projectHandle: 'project',
        conversationId: 'conversation',
        input: '继续制作',
      }
      await expect(
        service.prompt({ ...input, requestId: 'empty' }),
      ).rejects.toThrow('模型未返回可见回复')
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(agent.prompt).toHaveBeenCalledOnce()
      agent.state.messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: '已完成' }],
      })
      await expect(
        service.prompt({ ...input, requestId: 'continue' }),
      ).resolves.toMatchObject({ text: '已完成' })
      expect(createAgent).toHaveBeenCalledOnce()
    },
  )
})

describe('BaseAgentService prompt references', () => {
  it('routes raw PowerPoint files through pptx_read instead of the binary read tool', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-agent-pptx-'))
    await writeFile(join(projectPath, 'brief.pptx'), Buffer.from([1, 2, 3]))
    const service = new BaseAgentService(
      {} as never,
      {} as never,
      '/agent',
      '/skills',
      {} as never,
      {} as never,
      {} as never,
    )
    const internal = service as unknown as {
      injectPromptReferences(
        input: ReturnType<typeof normalizeAgentPromptInput>,
        path: string,
      ): Promise<string>
    }
    const prompt = normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-1',
      input: '总结这份 PowerPoint',
      references: [{ type: 'file', path: 'brief.pptx' }],
    })

    const injected = await internal.injectPromptReferences(prompt, projectPath)

    expect(injected).toContain('使用 pptx_read 工具')
    expect(injected).toContain('brief.pptx')
    expect(injected).not.toContain('使用 read 工具读取')
  })

  it('routes SlideMind presentations through slides_read instead of the text read tool', async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), 'slidemind-agent-presentation-'),
    )
    await writeFile(
      join(projectPath, 'brief.slides.json'),
      JSON.stringify(createBlankPresentationDocument('Brief')),
    )
    const service = new BaseAgentService(
      {} as never,
      {} as never,
      '/agent',
      '/skills',
      {} as never,
      {} as never,
      {} as never,
    )
    const internal = service as unknown as {
      injectPromptReferences(
        input: ReturnType<typeof normalizeAgentPromptInput>,
        path: string,
      ): Promise<string>
    }
    const prompt = normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-1',
      input: '总结这份演示',
      references: [{ type: 'file', path: 'brief.slides.json' }],
    })

    const injected = await internal.injectPromptReferences(prompt, projectPath)

    expect(injected).toContain('使用 slides_read 工具')
    expect(injected).toContain('brief.slides.json')
    expect(injected).not.toContain('使用 read 工具读取')
  })

  it('routes Word documents through document_read instead of the binary read tool', async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), 'slidemind-agent-document-'),
    )
    await writeFile(join(projectPath, 'brief.docx'), Buffer.from([1, 2, 3]))
    const service = new BaseAgentService(
      {} as never,
      {} as never,
      '/agent',
      '/skills',
      {} as never,
      {} as never,
      {} as never,
    )
    const internal = service as unknown as {
      injectPromptReferences(
        input: ReturnType<typeof normalizeAgentPromptInput>,
        path: string,
      ): Promise<string>
    }
    const prompt = normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-1',
      input: '总结这份 Word 文档',
      references: [{ type: 'file', path: 'brief.docx' }],
    })

    const injected = await internal.injectPromptReferences(prompt, projectPath)

    expect(injected).toContain('使用 document_read 工具')
    expect(injected).toContain('brief.docx')
    expect(injected).toContain('nextCursor')
    expect(injected).not.toContain('使用 read 工具读取')
  })

  it.each(['brief.xls', 'brief.xlsx', 'brief.pdf'])(
    'routes %s through document_read instead of the binary read tool',
    async (relativePath) => {
      const projectPath = await mkdtemp(
        join(tmpdir(), 'slidemind-agent-document-'),
      )
      await writeFile(join(projectPath, relativePath), Buffer.from([1, 2, 3]))
      const service = new BaseAgentService(
        {} as never,
        {} as never,
        '/agent',
        '/skills',
        {} as never,
        {} as never,
        {} as never,
      )
      const internal = service as unknown as {
        injectPromptReferences(
          input: ReturnType<typeof normalizeAgentPromptInput>,
          path: string,
        ): Promise<string>
      }
      const prompt = normalizeAgentPromptInput({
        requestId: 'request-1',
        conversationId: 'conversation-1',
        projectHandle: 'project-1',
        input: '总结这份办公文档',
        references: [{ type: 'file', path: relativePath }],
      })

      const injected = await internal.injectPromptReferences(
        prompt,
        projectPath,
      )

      expect(injected).toContain('使用 document_read 工具')
      expect(injected).toContain(relativePath)
      expect(injected).not.toContain('使用 read 工具读取')
    },
  )

  it('keeps regular text references on the text read tool', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-agent-text-'))
    await writeFile(join(projectPath, 'brief.md'), '# Brief')
    const service = new BaseAgentService(
      {} as never,
      {} as never,
      '/agent',
      '/skills',
      {} as never,
      {} as never,
      {} as never,
    )
    const internal = service as unknown as {
      injectPromptReferences(
        input: ReturnType<typeof normalizeAgentPromptInput>,
        path: string,
      ): Promise<string>
    }
    const prompt = normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-1',
      input: '总结这份 Markdown',
      references: [{ type: 'file', path: 'brief.md' }],
    })

    const injected = await internal.injectPromptReferences(prompt, projectPath)

    expect(injected).toContain('使用 read 工具读取')
    expect(injected).not.toContain('document_read')
    expect(injected).not.toContain('pptx_read')
    expect(injected).not.toContain('slides_read')
  })
})

describe('BaseAgentService configuration lifecycle', () => {
  it('retains active and queued requests when more than 50 conversations are opened', async () => {
    const service = new BaseAgentService(
      {
        load: async () => ({ modelId: 'deepseek-flash', apiKey: 'fake' }),
      } as never,
      { resolve: () => '/project' } as never,
      '/agent',
      '/skills',
      {} as never,
      {} as never,
      {} as never,
    )
    let finishPrompt!: () => void
    const pending = new Promise<void>((resolve) => {
      finishPrompt = resolve
    })
    const makeAgent = () => ({
      prompt: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      dispose: vi.fn(),
      setThinkingLevel: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      state: {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        ],
      },
    })
    const first = makeAgent()
    first.prompt.mockImplementationOnce(() => pending)
    const createAgent = vi
      .fn()
      .mockResolvedValueOnce({ agent: first, todos: [] })
      .mockImplementation(async () => ({ agent: makeAgent(), todos: [] }))
    Object.assign(service, { createAgent })
    const input = {
      projectHandle: 'project',
      conversationId: 'conversation-0',
      input: 'hello',
    }
    const active = service.prompt({ ...input, requestId: 'active' })
    await vi.waitFor(() => expect(first.prompt).toHaveBeenCalledOnce())
    const queued = service.prompt({ ...input, requestId: 'queued' })
    try {
      for (let index = 1; index <= 50; index++) {
        await service.prompt({
          ...input,
          conversationId: `conversation-${index}`,
          requestId: `request-${index}`,
        })
      }
      expect(first.abort).not.toHaveBeenCalled()
      expect(first.dispose).not.toHaveBeenCalled()
    } finally {
      finishPrompt()
      await Promise.all([active, queued])
    }
    await service.prompt({ ...input, requestId: 'resume' })
    expect(first.prompt).toHaveBeenCalledTimes(3)
    expect(createAgent).toHaveBeenCalledTimes(51)
  })

  it('keeps an active request on its snapshot and rebuilds only on the next changed configuration', async () => {
    let config = { modelId: 'deepseek-flash', apiKey: 'fake-first' }
    const service = new BaseAgentService(
      { load: async () => ({ ...config }) } as never,
      { resolve: () => '/project' } as never,
      '/agent',
      '/skills',
      {} as never,
      {} as never,
      {} as never,
    )
    let finishPrompt!: () => void
    const pending = new Promise<void>((resolve) => {
      finishPrompt = resolve
    })
    const makeAgent = () => ({
      prompt: vi.fn(async () => {}),
      dispose: vi.fn(),
      setThinkingLevel: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      state: {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        ],
      },
    })
    const first = makeAgent()
    first.prompt.mockImplementationOnce(() => pending)
    const second = makeAgent()
    const third = makeAgent()
    const createAgent = vi
      .fn()
      .mockResolvedValueOnce({ agent: first, todos: [] })
      .mockResolvedValueOnce({ agent: second, todos: [] })
      .mockResolvedValueOnce({ agent: third, todos: [] })
    Object.assign(service, { createAgent })
    const input = {
      projectHandle: 'project',
      conversationId: 'conversation',
      input: 'hello',
    }
    const active = service.prompt({ ...input, requestId: '1' })
    await vi.waitFor(() => expect(first.prompt).toHaveBeenCalledOnce())
    config = { ...config, apiKey: 'fake-second' }
    const queued = service.prompt({ ...input, requestId: '2' })
    expect(first.dispose).not.toHaveBeenCalled()
    expect(createAgent).toHaveBeenCalledTimes(1)
    finishPrompt()
    await Promise.all([active, queued])
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(createAgent.mock.calls[0][0].apiKey).toBe('fake-first')
    expect(createAgent.mock.calls[1][0].apiKey).toBe('fake-second')
    expect(createAgent.mock.calls[1].slice(1, 4)).toEqual([
      '/project',
      'project',
      'conversation',
    ])
    await service.prompt({ ...input, requestId: '3' })
    expect(createAgent).toHaveBeenCalledTimes(2)
    expect(second.prompt).toHaveBeenCalledTimes(2)
    config = { ...config, modelId: 'deepseek-v4-pro' }
    await service.prompt({ ...input, requestId: '4' })
    expect(second.dispose).toHaveBeenCalledOnce()
    expect(createAgent.mock.calls[2][0].modelId).toBe('deepseek-v4-pro')
  })

  it('creates independent credential stores and keeps the metadata runtime free of credentials', async () => {
    const service = new BaseAgentService(
      {} as never,
      {} as never,
      '/agent',
      '/skills',
      {} as never,
      {} as never,
      {} as never,
    )
    const internal = service as unknown as {
      createModelRuntime(): Promise<
        import('@earendil-works/pi-coding-agent').ModelRuntime
      >
      getModelRuntime(): Promise<
        import('@earendil-works/pi-coding-agent').ModelRuntime
      >
    }
    const [first, second, metadata] = await Promise.all([
      internal.createModelRuntime(),
      internal.createModelRuntime(),
      internal.getModelRuntime(),
    ])
    await first.setRuntimeApiKey('deepseek', 'fake-first')
    await second.setRuntimeApiKey('deepseek', 'fake-second')
    expect(await first.getAuth('deepseek')).toMatchObject({
      auth: { apiKey: 'fake-first' },
    })
    expect(await second.getAuth('deepseek')).toMatchObject({
      auth: { apiKey: 'fake-second' },
    })
    expect(metadata.hasConfiguredAuth('deepseek')).toBe(false)
    await second.setRuntimeApiKey('deepseek', 'fake-replacement')
    expect(await first.getAuth('deepseek')).toMatchObject({
      auth: { apiKey: 'fake-first' },
    })
  })
})
