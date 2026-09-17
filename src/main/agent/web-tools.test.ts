import { mkdtemp, rm, writeFile, readdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  type Model,
  type AssistantMessage,
} from '@earendil-works/pi-ai'
import {
  createWebToolsExtension,
  fetchWebSource,
  type WebToolsOptions,
} from './web-tools'
import { extractWebHtml } from './web-extract'
import { parseExaResponse } from './web-search'
import { requestWeb, WebError, type WebTransport } from './web-transport'
import { WebCache, visibleWebResponses } from './web-cache'

const dirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'slidemind-web-'))
  dirs.push(dir)
  return dir
}
const response = (text: string) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text }] },
  })
const searchResponse = response(
  JSON.stringify({
    results: [
      {
        title: 'Source',
        url: 'https://example.com/report',
        text: 'Search excerpt',
      },
    ],
  }),
)
const source = {
  url: 'https://example.com',
  title: 'Test',
  text: '中文 evidence here',
  kind: 'page' as const,
}

async function registeredTools(transport: WebTransport) {
  const tools = new Map<string, Parameters<ExtensionAPI['registerTool']>[0]>()
  const options: WebToolsOptions = {
    cacheDirectory: await directory(),
    getBranch: () => [],
    parsePdf: async () => '',
    transport,
  }
  await createWebToolsExtension(options)({
    registerTool: (tool: Parameters<ExtensionAPI['registerTool']>[0]) => {
      tools.set(tool.name, tool)
    },
  } as unknown as ExtensionAPI)
  return tools
}

describe('managed web tools', () => {
  it('parses SSE sources but rejects changed/error payloads instead of fabricating evidence', () => {
    expect(
      parseExaResponse(`event: message\ndata: ${searchResponse}\n\n`),
    ).toEqual([
      {
        url: 'https://example.com/report',
        title: 'Source',
        text: 'Search excerpt',
        kind: 'search_excerpt',
      },
    ])
    expect(parseExaResponse(response('No results found'))).toEqual([])
    expect(() => parseExaResponse(response('Unknown format'))).toThrow(
      '格式已变化',
    )
    expect(() => parseExaResponse('{"error":{"code":429}}')).toThrow('限额')
  })

  it('blocks private IPv4, IPv6 and non-web protocols through the actual transport', async () => {
    for (const url of [
      'http://127.0.0.1',
      'https://10.0.0.1',
      'http://[::1]',
      'http://169.254.169.254',
      'file:///etc/passwd',
      'https://user:secret@example.com',
    ]) {
      await expect(
        requestWeb(url, new AbortController().signal),
      ).rejects.toThrow()
    }
  })

  it('extracts readable content in a worker without running page scripts', async () => {
    const html = `<html><head><title>Report</title></head><body><article><h1>Report</h1>${'<p>This is a detailed research report describing observable evidence and useful source material for the presentation.</p>'.repeat(20)}<script>throw new Error('PAGE_SCRIPT_EXECUTED')</script></article></body></html>`
    const result = await extractWebHtml(html, new AbortController().signal)
    expect(result.text).toContain('observable evidence')
    expect(result.text).not.toContain('PAGE_SCRIPT_EXECUTED')
  })

  it('passes bounded PDF bytes to the application parser and rejects unsupported media', async () => {
    const parsePdf = vi.fn(async () => 'PDF evidence')
    const transport: WebTransport = async (url) => ({
      url,
      bytes: Buffer.from('%PDF-1.7'),
      contentType: 'application/pdf',
    })
    expect(
      await fetchWebSource(
        'https://example.com/report.pdf',
        new AbortController().signal,
        { transport, parsePdf },
      ),
    ).toMatchObject({ text: 'PDF evidence', kind: 'page' })
    expect(parsePdf).toHaveBeenCalledOnce()
    await expect(
      fetchWebSource(
        'https://example.com/video',
        new AbortController().signal,
        {
          parsePdf,
          transport: async (url) => ({
            url,
            bytes: Buffer.from('x'),
            contentType: 'video/mp4',
          }),
        },
      ),
    ).rejects.toThrow('仅支持')
  })

  it('isolates cache access by current branch and survives reload without old plugin config', async () => {
    const dir = await directory()
    let entries: unknown[] = []
    const cache = new WebCache(dir, () => visibleWebResponses(entries))
    const id = await cache.put([source])
    await expect(cache.get(id)).rejects.toThrow('当前会话分支')
    entries = [
      { message: { role: 'toolResult', details: { webResponseId: id } } },
    ]
    expect(
      await new WebCache(dir, () => visibleWebResponses(entries)).get(id),
    ).toEqual([source])
    entries = []
    await expect(cache.get(id)).rejects.toThrow('当前会话分支')
    const other = new WebCache(await directory(), () => new Set([id]))
    await expect(other.get(id)).rejects.toThrow('过期或被清理')
  })

  it('loads exactly four internal tools and searches without provider environment discovery', async () => {
    const dir = await directory()
    await writeFile(
      join(dir, 'web-search.json'),
      '{"exaApiKey":"!exit 1","provider":"gemini"}',
    )
    vi.stubEnv('EXA_API_KEY', 'fake-key-not-to-use')
    vi.stubEnv('EXA_BASE_URL', 'http://127.0.0.1')
    const branch: unknown[] = []
    const transport = vi.fn<WebTransport>(async (url, _signal, options) => ({
      url,
      bytes: Buffer.from(options?.body ? searchResponse : 'Original evidence'),
      contentType: options?.body ? 'application/json' : 'text/plain',
    }))
    const { DefaultResourceLoader } = await import(
      '@earendil-works/pi-coding-agent'
    )
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: 'web',
          factory: createWebToolsExtension({
            cacheDirectory: join(dir, 'cache'),
            getBranch: () => branch,
            transport,
            parsePdf: async () => '',
          }),
        },
      ],
    })
    await loader.reload()
    const loaded = loader.getExtensions()
    expect(loaded.errors).toEqual([])
    const tools = loaded.extensions[0].tools
    expect([...tools.keys()]).toEqual([
      'web_search',
      'source_check',
      'fetch_content',
      'get_search_content',
    ])
    // Execute the actual registered tool implementation, not only an event guard.
    const definition = tools.get('source_check')!.definition
    const result = await definition.execute(
      'test',
      { query: 'evidence' },
      new AbortController().signal,
      undefined,
      {} as never,
    )
    expect(JSON.stringify(result)).toContain('Original evidence')
    expect(JSON.stringify(result)).not.toContain('confidence')
    branch.push({ message: { role: 'toolResult', details: result.details } })
    const saved = result.details as { responseId: string }
    const cached = await tools
      .get('get_search_content')!
      .definition.execute(
        'read',
        { responseId: saved.responseId, findText: 'evidence' },
        new AbortController().signal,
        undefined,
        {} as never,
      )
    expect(JSON.stringify(cached)).toContain('evidence')
    branch.length = 0
    await expect(
      tools
        .get('get_search_content')!
        .definition.execute(
          'read-other-branch',
          { responseId: saved.responseId },
          new AbortController().signal,
          undefined,
          {} as never,
        ),
    ).rejects.toThrow('当前会话分支无法读取')
    expect(transport.mock.calls[0][0]).toBe(
      'https://mcp.exa.ai/mcp?tools=web_search_advanced_exa',
    )
    expect(JSON.stringify(transport.mock.calls)).not.toContain('fake-key')
    expect(await readdir(dir)).toContain('web-search.json')
  }, 15000)

  it('honors cancellation before starting a request or parser', async () => {
    const signal = AbortSignal.abort()
    await expect(requestWeb('https://example.com', signal)).rejects.toThrow()
    await expect(extractWebHtml('<p>text</p>', signal)).rejects.toThrow()
  })

  it('records fetch failures as errors through the Pi agent loop', async () => {
    const tools = await registeredTools(async () => {
      throw new WebError('Web 请求失败（HTTP 404）')
    })
    const tool = tools.get('fetch_content')!
    const model: Model<'openai-completions'> = {
      id: 'test-model',
      name: 'Test',
      api: 'openai-completions',
      provider: 'test',
      baseUrl: 'https://example.com',
      reasoning: false,
      input: ['text'],
      contextWindow: 10000,
      maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
    let turn = 0
    const events: AgentEvent[] = []
    const agent = new Agent({
      initialState: {
        model,
        tools: [
          {
            name: tool.name,
            label: tool.label,
            description: tool.description,
            parameters: tool.parameters,
            execute: (id, args, signal, update) =>
              tool.execute(id, args, signal, update, {} as never),
          },
        ],
      },
      streamFn: () => {
        const first = turn++ === 0
        const message: AssistantMessage = {
          role: 'assistant',
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: first
            ? [
                {
                  type: 'toolCall',
                  id: 'fetch',
                  name: 'fetch_content',
                  arguments: { url: 'https://example.com/missing' },
                },
              ]
            : [{ type: 'text', text: '来源读取失败' }],
          stopReason: first ? 'toolUse' : 'stop',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          timestamp: Date.now(),
        }
        const stream = createAssistantMessageEventStream()
        stream.push({
          type: 'done',
          reason: message.stopReason as 'stop' | 'toolUse',
          message,
        })
        return stream
      },
    })
    agent.subscribe((event) => {
      events.push(event)
    })
    await agent.prompt('读取来源')
    expect(
      agent.state.messages.find((message) => message.role === 'toolResult'),
    ).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Web 请求失败（HTTP 404）' }],
    })
    expect(
      events.find((event) => event.type === 'tool_execution_end'),
    ).toMatchObject({ isError: true })
  })

  it('rejects cancellation and preserves unexpected errors instead of returning successful error payloads', async () => {
    const failure = new TypeError('unexpected parser failure')
    const transport = vi.fn<WebTransport>(async () => {
      throw failure
    })
    const tools = await registeredTools(transport)
    const fetch = tools.get('fetch_content')!
    await expect(
      fetch.execute(
        'cancelled',
        { url: 'https://example.com' },
        AbortSignal.abort(),
        undefined,
        {} as never,
      ),
    ).rejects.toThrow('已取消或超时')
    expect(transport).not.toHaveBeenCalled()
    await expect(
      fetch.execute(
        'unexpected',
        { url: 'https://example.com' },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toBe(failure)
  })

  it('retains the requested URL when a source redirects and reports partial failures separately', async () => {
    const tools = await registeredTools(async (url) => {
      if (url.endsWith('/missing'))
        throw new WebError('Web 请求失败（HTTP 404）')
      return {
        url: 'https://example.com/',
        contentType: 'text/plain',
        bytes: Buffer.from('Homepage, not the requested article'),
      }
    })
    const result = await tools.get('fetch_content')!.execute(
      'redirect',
      {
        urls: ['https://example.com/article', 'https://example.com/missing'],
      },
      undefined,
      undefined,
      {} as never,
    )
    expect(result.details).toMatchObject({
      sources: [
        {
          requestedUrl: 'https://example.com/article',
          url: 'https://example.com/',
          kind: 'page',
        },
        {
          url: 'https://example.com/missing',
          error: 'Web 请求失败（HTTP 404）',
        },
      ],
    })
  })

  it('expires persisted results and evicts the oldest entry at the session budget', async () => {
    const dir = await directory()
    const visible = new Set<string>()
    const cache = new WebCache(dir, () => visible)
    const id = await cache.put([source])
    visible.add(id)
    const [file] = await readdir(dir)
    await rename(join(dir, file), join(dir, `1-${id}.json`))
    await expect(cache.get(id)).rejects.toThrow('过期')
    const ids: string[] = []
    for (let i = 0; i < 33; i++) {
      const next = await cache.put([source])
      ids.push(next)
      visible.add(next)
    }
    expect(await readdir(dir)).toHaveLength(32)
    await expect(cache.get(ids[0])).rejects.toThrow('被清理')
    expect(await cache.get(ids[32])).toEqual([source])
  })
})
