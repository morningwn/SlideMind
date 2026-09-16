import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, session } from 'electron'
import PDFDocument from 'pdfkit'
import type {
  ExportMarkdownPdfInput,
  ExportPresentationPdfInput,
  PdfExportResult,
} from '../../shared/pdf-export'
import { getLogger, registerSensitivePath } from '../logging/logger'
import { ProjectTextFileStore } from '../project/project-text-files'
import { ProjectPresentationStore } from '../presentation/presentation-store'
import { renderPresentationSlidesIncrementally } from '../presentation/presentation-renderer'
import type { ProjectMutationService } from '../version-control/project-mutation-service'
import {
  commitPdf,
  outputRevision,
  removeTemporaryPdf,
  resolvePdfOutputPath,
  temporaryPdfPath,
  validatePdf,
} from './pdf-output'

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_IMAGES = 100
const MAX_SLIDES = 30
const MAX_PNG_BYTES = 20 * 1024 * 1024
const MAX_CAPTURE_PIXELS = 12_000_000
const EXPORT_TIMEOUT_MS = 120_000
const logger = getLogger('pdf-export')

interface ActiveTask {
  controller: AbortController
  done: Promise<void>
  resolveDone: () => void
}

function validPath(value: unknown, suffix: RegExp): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 4096 &&
    !value.includes('\0') &&
    suffix.test(value)
  )
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('PDF 导出已取消或超时')
}

export function gifFrameCount(bytes: Buffer): number {
  if (
    bytes.length < 13 ||
    !bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')
  ) {
    throw new Error('GIF 图片无效')
  }
  let offset = 13
  const packed = bytes[10]
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1)
  let frames = 0
  while (offset < bytes.length) {
    const marker = bytes[offset++]
    if (marker === 0x3b) return frames
    if (marker === 0x2c) {
      frames += 1
      if (frames > 1) return frames
      if (offset + 9 > bytes.length) break
      const imagePacked = bytes[offset + 8]
      offset += 9
      if (imagePacked & 0x80) offset += 3 * 2 ** ((imagePacked & 7) + 1)
      offset += 1
    } else if (marker === 0x21) {
      offset += 1
    } else {
      break
    }
    for (;;) {
      if (offset >= bytes.length) throw new Error('GIF 图片无效')
      const length = bytes[offset++]
      if (length === 0) break
      offset += length
      if (offset > bytes.length) throw new Error('GIF 图片无效')
    }
  }
  throw new Error('GIF 图片无效')
}

async function loadPrintPage(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    const base = developmentUrl.endsWith('/')
      ? developmentUrl
      : `${developmentUrl}/`
    await window.loadURL(new URL('markdown-pdf.html', base).toString())
  } else {
    await window.loadFile(
      join(app.getAppPath(), 'out/renderer/markdown-pdf.html'),
    )
  }
}

async function renderMarkdownPdf(
  projectPath: string,
  input: ExportMarkdownPdfInput,
  temporaryPath: string,
  signal: AbortSignal,
): Promise<number> {
  const partition = `pdf-export-${randomUUID()}`
  const isolatedSession = session.fromPartition(partition, { cache: false })
  const allowedRoot = join(app.getAppPath(), 'out/renderer')
  const developmentOrigin = process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).origin
    : null
  let blockedResource = false
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false
    try {
      const url = new URL(details.url)
      allowed =
        url.protocol === 'data:' ||
        (developmentOrigin !== null && url.origin === developmentOrigin) ||
        (developmentOrigin !== null &&
          (url.protocol === 'ws:' || url.protocol === 'wss:') &&
          url.host === new URL(developmentOrigin).host) ||
        (url.protocol === 'file:' &&
          fileURLToPath(url).startsWith(`${allowedRoot}/`))
    } catch {
      allowed = false
    }
    if (!allowed) blockedResource = true
    callback({ cancel: !allowed })
  })
  const window = new BrowserWindow({
    width: 900,
    height: 1000,
    show: false,
    webPreferences: {
      session: isolatedSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  const abort = (): void => window.destroy()
  signal.addEventListener('abort', abort, { once: true })
  try {
    await loadPrintPage(window)
    assertNotAborted(signal)
    const paths = (await window.webContents.executeJavaScript(
      `window.slidemindPdfPage.render(${JSON.stringify(input.content)})`,
      true,
    )) as string[]
    const uniquePaths = [...new Set(paths)]
    if (uniquePaths.length > MAX_IMAGES)
      throw new Error('Markdown 图片超过 100 张')
    const images: Record<string, string> = {}
    const textFiles = new ProjectTextFileStore()
    let imageBytes = 0
    for (const path of uniquePaths) {
      assertNotAborted(signal)
      const dataUrl = await textFiles.readPreviewAsset(
        projectPath,
        input.path,
        path,
      )
      const match =
        /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
          dataUrl,
        )
      if (!match) throw new Error('Markdown 图片格式无效')
      const bytes = Buffer.from(match[2], 'base64')
      imageBytes += bytes.length
      if (imageBytes > MAX_IMAGE_BYTES)
        throw new Error('Markdown 图片总量超过 25 MiB')
      if (match[1] === 'image/gif' && gifFrameCount(bytes) !== 1) {
        throw new Error('暂不支持动画 GIF 导出 PDF')
      }
      images[path] = dataUrl
    }
    await window.webContents.executeJavaScript(
      `window.slidemindPdfPage.loadImages(${JSON.stringify(images)})`,
      true,
    )
    if (blockedResource) throw new Error('Markdown 包含未授权资源')
    assertNotAborted(signal)
    const bytes = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
    })
    assertNotAborted(signal)
    await writeFile(temporaryPath, bytes, { flag: 'wx' })
    const pageCount = await validatePdf(temporaryPath)
    if (pageCount > 100) throw new Error('Markdown PDF 超过 100 页')
    return pageCount
  } finally {
    signal.removeEventListener('abort', abort)
    if (!window.isDestroyed()) window.destroy()
  }
}

async function renderPresentationPdf(
  presentation: Awaited<
    ReturnType<ProjectPresentationStore['read']>
  >['document']['presentation'],
  temporaryPath: string,
  signal: AbortSignal,
): Promise<number> {
  const count = presentation.slides.length
  if (count < 1 || count > MAX_SLIDES)
    throw new Error(`PDF 导出仅支持 1–${MAX_SLIDES} 页演示文稿`)
  const ratio = presentation.viewportRatio
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 2)
    throw new Error('演示文稿页面比例无效')
  const pageWidth = 960
  const pageHeight = pageWidth * ratio
  const document = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    margin: 0,
  })
  const stream = createWriteStream(temporaryPath, { flags: 'wx' })
  const completed = new Promise<void>((resolve, reject) => {
    stream.once('finish', resolve)
    stream.once('error', reject)
    document.once('error', reject)
  })
  void completed.catch(() => undefined)
  document.pipe(stream)
  const abort = (): void => {
    ;(document as unknown as { destroy(error?: Error): void }).destroy(
      new Error('PDF 导出已取消'),
    )
    stream.destroy(new Error('PDF 导出已取消'))
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    await renderPresentationSlidesIncrementally(
      presentation,
      1,
      count,
      (slide) => {
        assertNotAborted(signal)
        if (slide.png.length > MAX_PNG_BYTES)
          throw new Error('单页幻灯片图片超过 20 MiB')
        if (slide.width * slide.height > MAX_CAPTURE_PIXELS) {
          throw new Error('单页幻灯片像素超过限制')
        }
        document.addPage({ size: [pageWidth, pageHeight], margin: 0 })
        document.image(slide.png, 0, 0, {
          width: pageWidth,
          height: pageHeight,
        })
      },
      signal,
      { targetPixelWidth: 2560, strictImages: true, restrictRequests: true },
    )
    assertNotAborted(signal)
    document.end()
    await completed
    await validatePdf(temporaryPath, count, ratio)
    return count
  } catch (error) {
    ;(document as unknown as { destroy(error?: Error): void }).destroy()
    stream.destroy()
    void completed.catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

export class PdfExportService {
  private readonly active = new Map<number, ActiveTask>()
  private readonly textFiles = new ProjectTextFileStore()
  private readonly presentations = new ProjectPresentationStore()

  constructor(
    private readonly mutations?: ProjectMutationService,
    private readonly timeoutMs = EXPORT_TIMEOUT_MS,
  ) {}

  isBusy(ownerId: number): boolean {
    return this.active.has(ownerId) || this.active.size >= 1
  }

  cancelOwner(ownerId: number): void {
    this.active.get(ownerId)?.controller.abort()
  }

  async close(): Promise<void> {
    const tasks = [...this.active.values()]
    for (const task of tasks) task.controller.abort()
    await Promise.all(tasks.map((task) => task.done))
  }

  async exportMarkdown(
    projectPath: string,
    projectHandle: string,
    inputValue: unknown,
    selectedPath: string,
    ownerId: number,
  ): Promise<PdfExportResult> {
    if (!inputValue || typeof inputValue !== 'object')
      return { status: 'failed', message: 'Markdown PDF 参数无效' }
    const input = inputValue as Partial<ExportMarkdownPdfInput>
    if (
      !validPath(input.path, /\.(?:md|markdown)$/i) ||
      typeof input.content !== 'string' ||
      Buffer.byteLength(input.content, 'utf8') > MAX_MARKDOWN_BYTES
    ) {
      return {
        status: 'failed',
        message: 'Markdown PDF 参数无效或内容超过 2 MiB',
      }
    }
    return this.run(
      'markdown',
      projectPath,
      projectHandle,
      selectedPath,
      ownerId,
      async (path, signal) => {
        await this.textFiles.read(projectPath, input.path!)
        return renderMarkdownPdf(
          projectPath,
          input as ExportMarkdownPdfInput,
          path,
          signal,
        )
      },
    )
  }

  async exportPresentation(
    projectPath: string,
    projectHandle: string,
    inputValue: unknown,
    selectedPath: string,
    ownerId: number,
  ): Promise<PdfExportResult> {
    if (
      !inputValue ||
      typeof inputValue !== 'object' ||
      !validPath(
        (inputValue as Partial<ExportPresentationPdfInput>).path,
        /\.slides\.json$/i,
      )
    ) {
      return { status: 'failed', message: '演示文稿 PDF 参数无效' }
    }
    const path = (inputValue as ExportPresentationPdfInput).path
    return this.run(
      'presentation',
      projectPath,
      projectHandle,
      selectedPath,
      ownerId,
      async (target, signal) => {
        const source = await this.presentations.read(projectPath, path)
        return renderPresentationPdf(
          source.document.presentation,
          target,
          signal,
        )
      },
    )
  }

  private async run(
    kind: 'markdown' | 'presentation',
    projectPath: string,
    projectHandle: string,
    selectedPath: string,
    ownerId: number,
    render: (temporaryPath: string, signal: AbortSignal) => Promise<number>,
  ): Promise<PdfExportResult> {
    if (this.isBusy(ownerId))
      return { status: 'failed', message: '已有 PDF 导出任务正在进行' }
    const controller = new AbortController()
    let resolveDone = (): void => undefined
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })
    this.active.set(ownerId, { controller, done, resolveDone })
    const operationId = randomUUID()
    const startedAt = Date.now()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    logger.info('pdf_export.started', { operationId, context: { kind } })
    let temporaryPath: string | undefined
    try {
      registerSensitivePath(dirname(selectedPath))
      const output = await resolvePdfOutputPath(projectPath, selectedPath)
      const initial = await outputRevision(output.outputPath)
      temporaryPath = temporaryPdfPath(output.outputPath)
      const pageCount = await render(temporaryPath, controller.signal)
      assertNotAborted(controller.signal)
      const commit = () => commitPdf(output.outputPath, temporaryPath!, initial)
      if (this.mutations && output.projectRelativePath !== undefined) {
        await this.mutations.run(
          {
            projectPath,
            projectHandle,
            paths: [output.projectRelativePath],
            source: kind === 'markdown' ? 'text-editor' : 'presentation-editor',
          },
          commit,
        )
      } else await commit()
      const outputBytes = (await stat(output.outputPath)).size
      logger.info('pdf_export.completed', {
        operationId,
        durationMs: Date.now() - startedAt,
        context: { kind, pageCount, outputBytes },
      })
      return { status: 'exported', outputPath: output.outputPath, pageCount }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF 导出失败'
      logger.warn('pdf_export.failed', {
        operationId,
        durationMs: Date.now() - startedAt,
        context: {
          kind,
          message: controller.signal.aborted
            ? 'canceled_or_timed_out'
            : 'failed',
        },
      })
      return {
        status: 'failed',
        message: controller.signal.aborted ? 'PDF 导出已取消或超时' : message,
      }
    } finally {
      clearTimeout(timeout)
      if (temporaryPath) await removeTemporaryPdf(temporaryPath)
      resolveDone()
      this.active.delete(ownerId)
    }
  }
}
