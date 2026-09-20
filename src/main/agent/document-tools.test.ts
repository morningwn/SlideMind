import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'
import {
  DocumentReadError,
  type DocumentReadResult,
} from '../../shared/document'
import { createDocumentToolsExtension } from './document-tools'

interface RegisteredTool {
  name: string
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{
    content: Array<{ text: string; type: string }>
    details: unknown
  }>
}

const result: DocumentReadResult = {
  content: '第一段正文',
  extractionStatus: 'complete',
  file: 'brief.docx',
  metadata: { title: ['项目简报'] },
  mimeType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  nextCursor: 'next-page',
  revision: 'a'.repeat(64),
  warnings: [],
}

async function register(
  read: (...args: never[]) => Promise<DocumentReadResult>,
) {
  const tools = new Map<string, RegisteredTool>()
  const extension = createDocumentToolsExtension({
    documentReader: { read },
    projectPath: '/project',
  })
  await extension({
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI)
  return tools.get('document_read')!
}

describe('createDocumentToolsExtension', () => {
  it('reads a project document and returns structured details', async () => {
    const read = vi.fn(async () => result)
    const tool = await register(read)

    const response = await tool.execute('read-document', {
      file: 'brief.docx',
      maxChars: 10_000,
    })

    expect(read).toHaveBeenCalledWith(
      '/project',
      {
        file: 'brief.docx',
        maxChars: 10_000,
      },
      undefined,
    )
    expect(response.details).toEqual(result)
    expect(JSON.parse(response.content[0].text)).toEqual(result)
  })

  it('passes cancellation to the reader and exposes known failure codes', async () => {
    const failure = new DocumentReadError('password_required', '文档需要密码')
    const read = vi.fn(async () => {
      throw failure
    })
    const tool = await register(read)
    const controller = new AbortController()

    await expect(
      tool.execute(
        'read-document',
        {
          file: 'protected.docx',
        },
        controller.signal,
      ),
    ).rejects.toThrow('文档读取失败（password_required）：文档需要密码')
    expect(read).toHaveBeenCalledWith(
      '/project',
      {
        file: 'protected.docx',
      },
      controller.signal,
    )
  })

  it('does not hide unexpected failures', async () => {
    const failure = new Error('unexpected parser failure')
    const tool = await register(async () => {
      throw failure
    })

    await expect(
      tool.execute('read-document', {
        file: 'brief.doc',
      }),
    ).rejects.toBe(failure)
  })

  it('explains unread sources on runtime failure without preventing later recovery', async () => {
    const failure = new DocumentReadError(
      'runtime_unavailable',
      '无法连接 Tika 运行时',
    )
    const read = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(result)
    const tool = await register(read)

    await expect(
      tool.execute('unavailable', { file: 'brief.pdf' }),
    ).rejects.toMatchObject({
      cause: failure,
      message: expect.stringContaining('本次未读取到文档内容'),
    })
    expect(read).toHaveBeenCalledTimes(1)
    const recovered = await tool.execute('recovered', { file: 'brief.pdf' })
    expect(recovered.details).toEqual(result)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
