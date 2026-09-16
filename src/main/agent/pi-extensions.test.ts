import { access, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEEPSEEK_MODEL_OPTIONS, DEEPSEEK_PROVIDER_ID } from '../../shared/agent'
import { registerDeepSeekModels } from './deepseek-models'
import {
  PI_AGENT_TOOL_NAMES,
  PI_EXTENSION_PATHS,
  PI_WEB_TOOL_NAMES,
  createWebAccessGuardExtension,
  preparePiExtensions
} from './pi-extensions'

describe('Pi extension integration', () => {
  it('keeps application DeepSeek models available without pi-free', async () => {
    const agentDirectory = join(tmpdir(), `slidemind-pi-models-${crypto.randomUUID()}`)
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      authPath: join(agentDirectory, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false
    })

    registerDeepSeekModels(runtime)
    for (const option of DEEPSEEK_MODEL_OPTIONS) {
      expect(runtime.getModel(DEEPSEEK_PROVIDER_ID, option.id)?.id).toBe(option.id)
    }
  })

  it('loads every pinned extension without native context-mode dependencies', async () => {
    const agentDirectory = join(tmpdir(), `slidemind-pi-extensions-${crypto.randomUUID()}`)
    const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR

    try {
      await preparePiExtensions(agentDirectory)
      const { DefaultResourceLoader } = await import('@earendil-works/pi-coding-agent')
      const loader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: agentDirectory,
        additionalExtensionPaths: [...PI_EXTENSION_PATHS],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true
      })

      await loader.reload()

      const extensions = loader.getExtensions()
      expect(extensions.errors).toEqual([])
      expect(extensions.extensions).toHaveLength(PI_EXTENSION_PATHS.length)
      expect(extensions.extensions.some((extension) => extension.path?.includes('pi-free'))).toBe(false)
      const registeredToolNames = new Set(
        extensions.extensions.flatMap((extension) => [...extension.tools.keys()])
      )
      for (const toolName of PI_WEB_TOOL_NAMES) {
        expect(registeredToolNames).toContain(toolName)
      }
    } finally {
      restoreEnvironment('PI_CODING_AGENT_DIR', previousAgentDirectory)
    }
  }, 15_000)

  it('preserves provider settings while enforcing headless cross-platform defaults', async () => {
    const agentDirectory = join(tmpdir(), `slidemind-pi-extension-config-${crypto.randomUUID()}`)
    await preparePiExtensions(agentDirectory)
    const continuePath = join(agentDirectory, 'extensions', 'pi-continue.json')
    const webSearchPath = join(agentDirectory, 'web-search.json')

    await Promise.all([access(continuePath), access(webSearchPath)])
    expect(JSON.parse(await readFile(continuePath, 'utf8'))).toEqual({
      showAfterCompact: false
    })
    expect(JSON.parse(await readFile(webSearchPath, 'utf8'))).toEqual({
      workflow: 'none',
      autoOpenBrowser: false,
      allowBrowserCookies: false,
      proxy: '',
      githubClone: { enabled: false },
      githubPrIssue: { enabled: false },
      youtube: { enabled: false },
      video: { enabled: false },
      image: { enabled: false }
    })

    await writeFile(webSearchPath, JSON.stringify({
      provider: 'exa',
      proxy: 'http://localhost:8080',
      githubClone: { enabled: true },
      youtube: { enabled: true }
    }))
    await preparePiExtensions(agentDirectory)
    expect(JSON.parse(await readFile(webSearchPath, 'utf8'))).toEqual({
      provider: 'exa',
      workflow: 'none',
      autoOpenBrowser: false,
      allowBrowserCookies: false,
      proxy: '',
      githubClone: { enabled: false },
      githubPrIssue: { enabled: false },
      youtube: { enabled: false },
      video: { enabled: false },
      image: { enabled: false }
    })
  })

  it('blocks pi-web-access paths that require system executables', async () => {
    const agentDirectory = join(tmpdir(), `slidemind-web-guard-${crypto.randomUUID()}`)
    const {
      createAgentSession,
      DefaultResourceLoader,
      ModelRuntime,
      SessionManager
    } = await import('@earendil-works/pi-coding-agent')
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: agentDirectory,
      extensionFactories: [{ name: 'web-guard', factory: createWebAccessGuardExtension }],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true
    })
    await loader.reload()
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDirectory, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false
    })
    const model = modelRuntime.getModels()[0]
    expect(model).toBeDefined()
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir: agentDirectory,
      modelRuntime,
      model: model!,
      tools: ['read'],
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(process.cwd())
    })

    try {
      const localFile = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'local-file',
        toolName: 'fetch_content',
        input: { url: join(tmpdir(), 'video.mp4') }
      })
      const videoFrames = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'video-frames',
        toolName: 'fetch_content',
        input: { url: 'https://example.com/video', frames: 3 }
      })
      const forcedClone = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'forced-clone',
        toolName: 'fetch_content',
        input: { url: 'https://github.com/openai/openai-node', forceClone: true }
      })
      const proxySearch = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'proxy-search',
        toolName: 'web_search',
        input: { query: 'Pi agent', proxy: 'http://localhost:8080' }
      })
      const regularPage = await session.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'regular-page',
        toolName: 'fetch_content',
        input: { url: 'https://example.com/report.pdf' }
      })

      expect(localFile?.block).toBe(true)
      expect(videoFrames?.block).toBe(true)
      expect(forcedClone?.block).toBe(true)
      expect(proxySearch?.block).toBe(true)
      expect(regularPage?.block).not.toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('activates four pure-JavaScript web tools and the managed downloader', () => {
    expect(PI_AGENT_TOOL_NAMES).toEqual([...PI_WEB_TOOL_NAMES, 'download_asset'])
  })
})

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
