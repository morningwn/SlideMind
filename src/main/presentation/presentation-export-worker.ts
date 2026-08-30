import { parentPort } from 'node:worker_threads'
import type { ISlideData } from '@univerjs/slides'
import { exportPresentationToPptx } from './presentation-exporter'

interface PresentationExportWorkerRequest {
  outputPath: string
  snapshot: ISlideData
}

interface PresentationExportWorkerResult {
  error?: string
  ok: boolean
}

const port = parentPort
if (!port) throw new Error('演示文稿导出 Worker 缺少父进程通道')

port.once('message', (request: PresentationExportWorkerRequest) => {
  void exportPresentationToPptx(request.snapshot, request.outputPath).then(
    () => port.postMessage({ ok: true } satisfies PresentationExportWorkerResult),
    (error: unknown) => port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies PresentationExportWorkerResult)
  )
})
