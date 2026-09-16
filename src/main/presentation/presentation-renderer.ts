import { app, BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

function renderWindowSize(
  presentation: PptistPresentation,
  width = RENDER_WIDTH,
  maxHeight = MAX_RENDER_HEIGHT,
): { height: number; width: number } {
  return {
    height: Math.max(
      360,
      Math.min(maxHeight, Math.round(width * presentation.viewportRatio)),
    ),
    width,
  }
}

async function loadPptistRenderer(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    const baseUrl = developmentUrl.endsWith('/')
      ? developmentUrl
      : `${developmentUrl}/`
    await window.loadURL(new URL('pptist.html', baseUrl).toString())
    return
  }
  await window.loadFile(join(app.getAppPath(), 'out/renderer/pptist.html'))
}

function assertReadyResult(
  value: unknown,
): asserts value is RendererReadyResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('幻灯片渲染结果无效')
  }
  const candidate = value as Record<string, unknown>
  const { height, left, top, width } = candidate
  if (
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    typeof left !== 'number' ||
    !Number.isFinite(left) ||
    typeof top !== 'number' ||
    !Number.isFinite(top) ||
    typeof width !== 'number' ||
    !Number.isFinite(width)
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
  presentation?: PptistPresentation,
  strictImages = false,
): Promise<RendererReadyResult> {
  const requestId = randomUUID()
  const message = JSON.stringify({
    type: 'slidemind:pptist:render',
    requestId,
    presentation,
    slideNumber,
    strictImages,
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
  rect: RendererReadyResult,
): Electron.Rectangle {
  const [contentWidth, contentHeight] = window.getContentSize()
  const x = Math.max(0, Math.floor(rect.left))
  const y = Math.max(0, Math.floor(rect.top))
  return {
    x,
    y,
    width: Math.max(1, Math.min(contentWidth - x, Math.ceil(rect.width))),
    height: Math.max(1, Math.min(contentHeight - y, Math.ceil(rect.height))),
  }
}

export async function renderPresentationSlides(
  presentation: PptistPresentation,
  startSlide: number,
  endSlide: number,
  signal?: AbortSignal,
): Promise<RenderedPresentationSlide[]> {
  const rendered: RenderedPresentationSlide[] = []
  await renderPresentationSlidesIncrementally(
    presentation,
    startSlide,
    endSlide,
    (slide) => {
      rendered.push(slide)
    },
    signal,
  )
  return rendered
}

export async function renderPresentationSlidesIncrementally(
  presentation: PptistPresentation,
  startSlide: number,
  endSlide: number,
  consume: (slide: RenderedPresentationSlide) => Promise<void> | void,
  signal?: AbortSignal,
  options: {
    width?: number
    targetPixelWidth?: number
    strictImages?: boolean
    restrictRequests?: boolean
  } = {},
): Promise<void> {
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

  const size = renderWindowSize(
    presentation,
    options.width,
    options.targetPixelWidth ? Number.POSITIVE_INFINITY : MAX_RENDER_HEIGHT,
  )
  const isolatedSession = options.restrictRequests
    ? session.fromPartition(`presentation-pdf-${randomUUID()}`, {
        cache: false,
      })
    : undefined
  let blockedResource = false
  if (isolatedSession) {
    const developmentOrigin = process.env.ELECTRON_RENDERER_URL
      ? new URL(process.env.ELECTRON_RENDERER_URL).origin
      : null
    const allowedRoot = join(app.getAppPath(), 'out/renderer')
    isolatedSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false
      try {
        const url = new URL(details.url)
        allowed =
          url.protocol === 'data:' ||
          url.protocol === 'blob:' ||
          (developmentOrigin !== null && url.origin === developmentOrigin) ||
          (developmentOrigin !== null &&
            (url.protocol === 'ws:' || url.protocol === 'wss:') &&
            url.host === new URL(developmentOrigin).host) ||
          (url.protocol === 'file:' &&
            fileURLToPath(url).startsWith(`${allowedRoot}/`))
      } catch {
        /* invalid URL */
      }
      if (!allowed) blockedResource = true
      callback({ cancel: !allowed })
    })
  }
  const window = new BrowserWindow({
    ...size,
    backgroundColor: presentation.theme.backgroundColor || '#ffffff',
    frame: false,
    show: false,
    useContentSize: true,
    webPreferences: {
      ...(isolatedSession ? { session: isolatedSession } : {}),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (options.restrictRequests) {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
  }
  const abort = (): void => window.destroy()
  signal?.addEventListener('abort', abort, { once: true })

  try {
    await loadPptistRenderer(window)
    window.webContents.setZoomFactor(1)
    if (options.targetPixelWidth) {
      const devicePixelRatio = (await window.webContents.executeJavaScript(
        'window.devicePixelRatio',
        true,
      )) as number
      if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
        throw new Error('幻灯片渲染缩放比例无效')
      }
      const targetWidth = Math.max(
        640,
        Math.min(2560, Math.round(options.targetPixelWidth / devicePixelRatio)),
      )
      const targetSize = renderWindowSize(
        presentation,
        targetWidth,
        Number.POSITIVE_INFINITY,
      )
      window.setContentSize(targetSize.width, targetSize.height)
    }
    for (
      let slideNumber = startSlide;
      slideNumber <= endSlide;
      slideNumber += 1
    ) {
      if (signal?.aborted || window.isDestroyed())
        throw new Error('幻灯片渲染已取消')
      const rect = await prepareSlide(
        window,
        slideNumber,
        slideNumber === startSlide ? presentation : undefined,
        options.strictImages,
      )
      const image = await window.webContents.capturePage(
        captureRectangle(window, rect),
      )
      if (blockedResource) throw new Error(`第 ${slideNumber} 页包含未授权资源`)
      if (image.isEmpty()) throw new Error(`第 ${slideNumber} 页渲染结果为空`)
      const png = image.toPNG()
      if (png.byteLength === 0)
        throw new Error(`第 ${slideNumber} 页 PNG 编码结果为空`)
      const imageSize = image.getSize()
      await consume({
        height: imageSize.height,
        number: slideNumber,
        png,
        width: imageSize.width,
      })
      blockedResource = false
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    if (!window.isDestroyed()) window.destroy()
  }
}
