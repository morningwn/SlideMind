import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { isPptxPath } from '../../shared/presentation'
import { resolveRegularProjectFile } from '../project/project-files'
import type { PptxReadSummary } from './pptx-read-summary'

const MAX_PPTX_BYTES = 30 * 1024 * 1024
const PPTX_READ_TIMEOUT_MS = 90_000

interface PptxReadWorkerResult {
  error?: string
  ok: boolean
  summary?: PptxReadSummary
}

function runPptxReadWorker(
  bytes: ArrayBuffer,
  startSlide: number | undefined,
  endSlide: number | undefined,
  signal?: AbortSignal
): Promise<PptxReadSummary> {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(resolve(__dirname, 'pptx-read-worker.js'), {
      resourceLimits: {
        maxOldGenerationSizeMb: 768,
        maxYoungGenerationSizeMb: 128,
        stackSizeMb: 8
      }
    })
    let settled = false
    const finish = (error?: Error, summary?: PptxReadSummary): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) rejectPromise(error)
      else if (summary) resolvePromise(summary)
      else rejectPromise(new Error('PPTX 读取结果无效'))
    }
    const abort = (): void => finish(new Error('PPTX 读取已取消'))
    const timeout = setTimeout(
      () => finish(new Error('PPTX 读取超时')),
      PPTX_READ_TIMEOUT_MS
    )
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }

    worker.once('message', (value: PptxReadWorkerResult) => {
      if (!value?.ok || !value.summary) finish(new Error(value?.error || 'PPTX 读取失败'))
      else finish(undefined, value.summary)
    })
    worker.once('error', (error) => finish(
      error instanceof Error ? error : new Error(String(error))
    ))
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(new Error(`PPTX 读取 Worker 异常退出：${code}`))
    })
    worker.postMessage({ bytes, startSlide, endSlide }, [bytes])
  })
}

export async function readProjectPptx(
  projectPath: string,
  relativePath: string,
  startSlide?: number,
  endSlide?: number,
  signal?: AbortSignal
): Promise<PptxReadSummary & { file: string }> {
  const file = await resolveRegularProjectFile(projectPath, relativePath)
  if (!isPptxPath(file.relativePath)) throw new Error('只能读取 .pptx 格式的 PowerPoint 文件')
  const fileStats = await stat(file.targetPath)
  if (fileStats.size === 0 || fileStats.size > MAX_PPTX_BYTES) {
    throw new Error('PPTX 文件必须大于 0 且不超过 30 MiB')
  }
  if (signal?.aborted) throw new Error('PPTX 读取已取消')
  const data = await readFile(file.targetPath)
  if (data.byteLength === 0 || data.byteLength > MAX_PPTX_BYTES) {
    throw new Error('PPTX 文件必须大于 0 且不超过 30 MiB')
  }
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  const summary = await runPptxReadWorker(bytes, startSlide, endSlide, signal)
  return { file: file.relativePath, ...summary }
}
