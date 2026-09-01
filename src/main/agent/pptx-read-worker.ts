import { parentPort } from 'node:worker_threads'
import { summarizePptxBytes } from './pptx-read-summary'

interface PptxReadWorkerRequest {
  bytes: ArrayBuffer
  endSlide?: number
  startSlide?: number
}

interface PptxReadWorkerResult {
  error?: string
  ok: boolean
  summary?: Awaited<ReturnType<typeof summarizePptxBytes>>
}

const port = parentPort
if (!port) throw new Error('PPTX 读取 Worker 缺少父进程通道')

port.once('message', (request: PptxReadWorkerRequest) => {
  void summarizePptxBytes(request.bytes, request.startSlide, request.endSlide).then(
    (summary) => port.postMessage({ ok: true, summary } satisfies PptxReadWorkerResult),
    (error: unknown) => port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies PptxReadWorkerResult)
  )
})
