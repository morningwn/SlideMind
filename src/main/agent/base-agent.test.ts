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
      lastUsedAt: Date.now(),
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
