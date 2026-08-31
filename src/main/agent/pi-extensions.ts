import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

function packageFile(packageName: string, ...segments: string[]): string {
  return join(dirname(require.resolve(`${packageName}/package.json`)), ...segments)
}

export const PI_EXTENSION_PATHS = [
  packageFile('pi-continue', 'extensions', 'continue', 'index.ts'),
  require.resolve('pi-free'),
  packageFile('pi-cache-optimizer', 'index.ts'),
  packageFile('pi-web-access', 'index.ts')
] as const

export const PI_WEB_TOOL_NAMES = [
  'web_search',
  'source_check',
  'fetch_content',
  'get_search_content'
] as const

export const PI_AGENT_TOOL_NAMES = [...PI_WEB_TOOL_NAMES, 'download_asset'] as const

const WEB_TOOLS_WITH_PROXY = new Set(['web_search', 'source_check', 'fetch_content'])
const FETCH_CONTENT_EXTERNAL_OPTIONS = ['auth', 'forceClone', 'frames', 'model', 'timestamp']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const createWebAccessGuardExtension: ExtensionFactory = (pi) => {
  pi.on('tool_call', (event) => {
    if (!WEB_TOOLS_WITH_PROXY.has(event.toolName) || !isRecord(event.input)) return
    const input = event.input as Record<string, unknown>

    if (typeof input.proxy === 'string' && input.proxy.trim()) {
      return {
        block: true,
        reason: 'SlideMind 未启用依赖系统 curl 的代理传输'
      }
    }
    if (event.toolName !== 'fetch_content') return

    const externalOption = FETCH_CONTENT_EXTERNAL_OPTIONS.find(
      (name) => input[name] !== undefined && input[name] !== false
    )
    if (externalOption) {
      return {
        block: true,
        reason: `SlideMind 的 fetch_content 不支持外部运行时选项：${externalOption}`
      }
    }

    const urls = [
      input.url,
      ...(Array.isArray(input.urls) ? input.urls : [])
    ].filter((value) => value !== undefined)
    if (urls.some((url) => !isHttpUrl(url))) {
      return {
        block: true,
        reason: 'SlideMind 的 fetch_content 仅允许 HTTP(S) 网页与 PDF 地址'
      }
    }
  })
}

async function writeJsonIfMissing(path: string, value: Record<string, unknown>): Promise<void> {
  try {
    await access(path, constants.F_OK)
  } catch {
    await mkdir(dirname(path), { recursive: true })
    try {
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

async function writeManagedJson(path: string, value: Record<string, unknown>): Promise<void> {
  let current: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!isRecord(parsed)) throw new Error(`配置文件格式无效：${path}`)
    current = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ ...current, ...value }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
}

export async function preparePiExtensions(agentDirectory: string): Promise<void> {
  process.env.PI_CODING_AGENT_DIR = agentDirectory
  process.env.PI_FREE_FILE_LOG = 'false'

  await Promise.all([
    writeJsonIfMissing(join(agentDirectory, 'extensions', 'pi-continue.json'), {
      showAfterCompact: false
    }),
    writeManagedJson(join(agentDirectory, 'web-search.json'), {
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
  ])
}
