import { opendir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { FilePolicy, FilePermissionError } from './file-policy'

const SCAN_BYTES = 16 * 1024 * 1024
const OUTPUT_BYTES = 50 * 1024
const MATCHER = String.raw`
const { parentPort, workerData: input } = require('node:worker_threads')
const { matchesGlob } = require('node:path')
let match
try {
  const expression = input.mode === 'grep' && !input.literal ? new RegExp(input.pattern, input.ignoreCase ? 'i' : '') : undefined
  const literal = input.ignoreCase ? input.pattern.toLowerCase() : input.pattern
  match = (text) => expression ? expression.test(text) : (input.ignoreCase ? text.toLowerCase() : text).includes(literal)
  const output = []
  let matches = 0
  for (const file of input.files) {
    if (input.glob && !matchesGlob(file.path, input.glob) && !matchesGlob(file.path.split('/').at(-1), input.glob)) continue
    if (input.mode === 'find') {
      if (matchesGlob(file.path, input.pattern) || matchesGlob(file.path.split('/').at(-1), input.pattern)) {
        output.push(file.path); matches++
      }
    } else {
      const lines = file.text.split('\n')
      const selected = new Set()
      for (let i = 0; i < lines.length && matches < input.limit; i++) {
        if (!match(lines[i])) continue
        matches++
        for (let j = Math.max(0, i - input.context); j <= Math.min(lines.length - 1, i + input.context); j++) selected.add(j)
      }
      for (const line of selected) output.push(file.path + ':' + (line + 1) + ': ' + lines[line].slice(0, 2000))
    }
    if (matches >= input.limit) break
  }
  parentPort.postMessage({ text: output.join('\n'), matches, limited: matches >= input.limit })
} catch (error) { parentPort.postMessage({ error: '搜索表达式或 glob 无效' }) }
`

async function matchFiles(
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ text: string; matches: number; limited: boolean }> {
  signal.throwIfAborted()
  const worker = new Worker(MATCHER, {
    eval: true,
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
  })
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(1500)])
  try {
    return await new Promise((resolveResult, reject) => {
      const abort = () => reject(new Error('搜索表达式执行超时或已取消'))
      deadline.addEventListener('abort', abort, { once: true })
      const cleanup = () => deadline.removeEventListener('abort', abort)
      worker.once(
        'message',
        (message: {
          text: string
          matches: number
          limited: boolean
          error?: string
        }) => {
          cleanup()
          if (message.error) reject(new Error(message.error))
          else resolveResult(message)
        },
      )
      worker.once('error', (error) => {
        cleanup()
        reject(error)
      })
      worker.once('exit', () => {
        cleanup()
        reject(new Error('搜索 Worker 已退出'))
      })
      if (deadline.aborted) abort()
    })
  } finally {
    await worker.terminate()
  }
}

export function createFileSearchTools(policy: FilePolicy): ExtensionFactory {
  return async (pi) => {
    const { Type } = await import('@earendil-works/pi-ai')
    for (const name of ['grep', 'find', 'ls'] as const) {
      pi.registerTool({
        name,
        label: name,
        description: `${name}：只搜索当前项目和明确允许的只读资源，跳过符号链接、凭据和受保护目录。不读取 .gitignore，所有普通隐藏文件遵循同一权限策略。最多扫描 10000 个目录项、深度 64、单文件 2 MiB、总文本 16 MiB；搜索结果最多 50 KiB。pattern 为 grep 正则/find glob；ls 不需要 pattern。`,
        parameters: Type.Object(
          {
            path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
            ...(name === 'ls'
              ? {}
              : { pattern: Type.String({ minLength: 1, maxLength: 500 }) }),
            limit: Type.Optional(
              Type.Integer({
                minimum: 1,
                maximum: name === 'grep' ? 1000 : 5000,
              }),
            ),
            ...(name === 'grep'
              ? {
                  glob: Type.Optional(Type.String({ maxLength: 500 })),
                  ignoreCase: Type.Optional(Type.Boolean()),
                  literal: Type.Optional(Type.Boolean()),
                  context: Type.Optional(
                    Type.Integer({ minimum: 0, maximum: 10 }),
                  ),
                }
              : {}),
          },
          { additionalProperties: false },
        ),
        async execute(_id, params, sourceSignal) {
          const signal = AbortSignal.any([
            ...(sourceSignal ? [sourceSignal] : []),
            AbortSignal.timeout(10_000),
          ])
          const input = params as {
            path?: string
            pattern?: string
            limit?: number
            glob?: string
            ignoreCase?: boolean
            literal?: boolean
            context?: number
          }
          const root = await policy.resolve(
            input.path ?? '.',
            'read',
            name === 'grep' ? 'either' : 'directory',
          )
          const files: Array<{ path: string; text: string }> = []
          let scanned = 0
          let bytes = 0
          let skipped = 0
          let limited = false
          const limit =
            input.limit ??
            (name === 'grep' ? 100 : name === 'find' ? 1000 : 500)
          const addFile = async (path: string) => {
            const display =
              relative(root, path).replaceAll('\\', '/') ||
              path.split(/[\\/]/).at(-1)!
            if (name !== 'grep') {
              files.push({ path: display, text: '' })
              return
            }
            try {
              const buffer = await policy.readFile(
                path,
                Math.min(2 * 1024 * 1024, SCAN_BYTES - bytes),
              )
              bytes += buffer.length
              if (buffer.includes(0)) {
                skipped++
                return
              }
              files.push({ path: display, text: buffer.toString('utf8') })
            } catch (error) {
              if (error instanceof FilePermissionError) {
                skipped++
                return
              }
              throw error
            }
          }
          const visit = async (
            directory: string,
            depth: number,
          ): Promise<void> => {
            signal.throwIfAborted()
            if (depth > 64) {
              limited = true
              return
            }
            const handle = await opendir(
              await policy.resolve(directory, 'read', 'directory'),
            )
            for await (const entry of handle) {
              signal.throwIfAborted()
              if (
                ++scanned > 10000 ||
                bytes >= SCAN_BYTES ||
                (name === 'ls' && files.length >= limit)
              ) {
                limited = true
                break
              }
              const path = resolve(directory, entry.name)
              try {
                await policy.resolve(path, 'read', 'either')
              } catch (error) {
                if (
                  error instanceof FilePermissionError ||
                  (error as NodeJS.ErrnoException).code === 'ENOENT'
                ) {
                  skipped++
                  continue
                }
                throw error
              }
              if (entry.isDirectory()) {
                if (name === 'ls')
                  files.push({ path: `${entry.name}/`, text: '' })
                else await visit(path, depth + 1)
              } else if (entry.isFile()) await addFile(path)
              if (scanned > 10000 || bytes >= SCAN_BYTES) {
                limited = true
                break
              }
            }
          }
          const { lstat } = await import('node:fs/promises')
          if ((await lstat(root)).isFile()) await addFile(root)
          else await visit(root, 0)
          signal.throwIfAborted()
          const matched =
            name === 'ls'
              ? {
                  text: files
                    .map((file) => file.path)
                    .sort()
                    .join('\n'),
                  matches: files.length,
                  limited: false,
                }
              : await matchFiles(
                  {
                    ...input,
                    pattern: input.pattern,
                    files,
                    limit,
                    mode: name,
                    context: input.context ?? 0,
                  },
                  signal,
                )
          const output = Buffer.from(matched.text)
          const truncated =
            limited || matched.limited || output.length > OUTPUT_BYTES
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  output.subarray(0, OUTPUT_BYTES).toString('utf8') +
                  (truncated ? '\n[结果已截断，请缩小搜索范围]' : ''),
              },
            ],
            details: { scanned, skipped, matches: matched.matches, truncated },
          }
        },
      })
    }
  }
}
