import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { PptistPresentation } from '../../shared/presentation'

export interface RenderedPresentationSlide {
  height: number
  number: number
  png: Buffer
  width: number
}

interface RendererReadyResult {
  height: number
  left: number
  top: number
  width: number
}

const RENDER_WIDTH = 1280
const MAX_RENDER_HEIGHT = 960
const RENDER_TIMEOUT_MS = 30_000

function renderWindowSize(presentation: PptistPresentation): { height: number; width: number } {
  return {
    height: Math.max(360, Math.min(
      MAX_RENDER_HEIGHT,
      Math.round(RENDER_WIDTH * presentation.viewportRatio)
    )),
    width: RENDER_WIDTH
  }
}

async function loadPptistRenderer(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    const baseUrl = developmentUrl.endsWith('/') ? developmentUrl : `${developmentUrl}/`
    await window.loadURL(new URL('pptist.html', baseUrl).toString())
    return
  }
  await window.loadFile(join(app.getAppPath(), 'out/renderer/pptist.html'))
}

function assertReadyResult(value: unknown): asserts value is RendererReadyResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('幻灯片渲染结果无效')
  }
  const candidate = value as Record<string, unknown>
  const { height, left, top, width } = candidate
  if (
    typeof height !== 'number' || !Number.isFinite(height) ||
    typeof left !== 'number' || !Number.isFinite(left) ||
    typeof top !== 'number' || !Number.isFinite(top) ||
    typeof width !== 'number' || !Number.isFinite(width)
  ) {
    throw new Error('幻灯片渲染区域无效')
  }
  if (width <= 0 || height <= 0) {
    throw new Error('幻灯片渲染区域为空')
  }
}

async function prepareSlide(
  window: BrowserWindow,
  slideNumber: number,
  presentation?: PptistPresentation
): Promise<RendererReadyResult> {
  const requestId = randomUUID()
  const message = JSON.stringify({
    type: 'slidemind:pptist:render',
    requestId,
    presentation,
    slideNumber
  })
  const requestIdValue = JSON.stringify(requestId)
  const timeoutMs = RENDER_TIMEOUT_MS
  const script = `(() => new Promise((resolve, reject) => {
    const requestId = ${requestIdValue};
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new Error('幻灯片渲染超时'));
    }, ${timeoutMs});
    const receive = (event) => {
      const data = event.data;
      if (!data || data.requestId !== requestId) return;
      if (data.type !== 'slidemind:pptist:render-ready' && data.type !== 'slidemind:pptist:render-error') return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
      if (data.type === 'slidemind:pptist:render-error') reject(new Error(data.message || '幻灯片渲染失败'));
      else resolve(data.rect);
    };
    window.addEventListener('message', receive);
    window.postMessage(${message}, '*');
  }))()`
  const result = await window.webContents.executeJavaScript(script, true)
  assertReadyResult(result)
  return result
}

function captureRectangle(
  window: BrowserWindow,
  rect: RendererReadyResult
): Electron.Rectangle {
  const [contentWidth, contentHeight] = window.getContentSize()
  const x = Math.max(0, Math.floor(rect.left))
  const y = Math.max(0, Math.floor(rect.top))
  return {
    x,
    y,
    width: Math.max(1, Math.min(contentWidth - x, Math.ceil(rect.width))),
    height: Math.max(1, Math.min(contentHeight - y, Math.ceil(rect.height)))
  }
}

export async function renderPresentationSlides(
  presentation: PptistPresentation,
  startSlide: number,
  endSlide: number,
  signal?: AbortSignal
): Promise<RenderedPresentationSlide[]> {
  if (
    !Number.isInteger(startSlide) ||
    !Number.isInteger(endSlide) ||
    startSlide < 1 ||
    endSlide < startSlide ||
    endSlide > presentation.slides.length
  ) {
    throw new Error('幻灯片渲染页码无效')
  }
  if (signal?.aborted) throw new Error('幻灯片渲染已取消')

  const size = renderWindowSize(presentation)
  const window = new BrowserWindow({
    ...size,
    backgroundColor: presentation.theme.backgroundColor || '#ffffff',
    frame: false,
    show: false,
    useContentSize: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const abort = (): void => window.destroy()
  signal?.addEventListener('abort', abort, { once: true })

  try {
    await loadPptistRenderer(window)
    window.webContents.setZoomFactor(1)
    const rendered: RenderedPresentationSlide[] = []
    for (let slideNumber = startSlide; slideNumber <= endSlide; slideNumber += 1) {
      if (signal?.aborted || window.isDestroyed()) throw new Error('幻灯片渲染已取消')
      const rect = await prepareSlide(
        window,
        slideNumber,
        slideNumber === startSlide ? presentation : undefined
      )
      const image = await window.webContents.capturePage(captureRectangle(window, rect))
      if (image.isEmpty()) throw new Error(`第 ${slideNumber} 页渲染结果为空`)
      const png = image.toPNG()
      if (png.byteLength === 0) throw new Error(`第 ${slideNumber} 页 PNG 编码结果为空`)
      const imageSize = image.getSize()
      rendered.push({
        height: imageSize.height,
        number: slideNumber,
        png,
        width: imageSize.width
      })
    }
    return rendered
  } finally {
    signal?.removeEventListener('abort', abort)
    if (!window.isDestroyed()) window.destroy()
  }
}
