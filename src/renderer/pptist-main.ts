import { createApp, nextTick, watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { parse } from 'pptxtojson'
import Editor from './pptist-editor.vue'
import Directive from '@/directive'
import { useMainStore, useSlidesStore, useSnapshotStore } from '@/store'
import useImport from '@/hooks/useImport'

import 'prosemirror-view/style/prosemirror.css'
import 'animate.css'
import '@/assets/styles/prosemirror.scss'
import '@/assets/styles/global.scss'
import '@/assets/styles/font.scss'

type PresentationState = {
  title: string
  theme: Record<string, unknown>
  slides: Array<Record<string, unknown>>
  viewportSize: number
  viewportRatio: number
}

type LoadHostMessage = {
  type: 'slidemind:pptist:load'
  presentation: PresentationState
}

type ImportHostMessage = {
  type: 'slidemind:pptist:import'
  requestId: string
  fileName: string
  bytes: ArrayBuffer
  presentation: PresentationState
}

type RenderHostMessage = {
  type: 'slidemind:pptist:render'
  requestId: string
  presentation?: PresentationState
  slideNumber: number
}

type HostMessage = LoadHostMessage | ImportHostMessage | RenderHostMessage

const MAX_IMPORT_BYTES = 30 * 1024 * 1024
const IMPORT_TIMEOUT_MS = 120_000

function post(message: Record<string, unknown>): void {
  window.parent.postMessage(message, '*')
}

function isPresentationState(value: unknown): value is PresentationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PresentationState>
  return typeof candidate.title === 'string' &&
    Array.isArray(candidate.slides) &&
    !!candidate.theme &&
    typeof candidate.theme === 'object' &&
    typeof candidate.viewportSize === 'number' &&
    typeof candidate.viewportRatio === 'number'
}

const pinia = createPinia()
setActivePinia(pinia)
const app = createApp(Editor)
app.use(Directive)
app.use(pinia)

const slidesStore = useSlidesStore(pinia)
const snapshotStore = useSnapshotStore(pinia)
const mainStore = useMainStore(pinia)
const { exporting: importing, importPPTXFile } = useImport()
let initialized = false
let changeTimer: number | undefined
let mounted = false
let pendingImport: { requestId: string; timeout: number } | undefined

function currentPresentation(): PresentationState {
  return JSON.parse(JSON.stringify({
    title: slidesStore.title,
    theme: slidesStore.theme,
    slides: slidesStore.slides,
    viewportSize: slidesStore.viewportSize,
    viewportRatio: slidesStore.viewportRatio
  })) as PresentationState
}

async function loadPresentation(presentation: PresentationState): Promise<void> {
  if (
    mounted &&
    JSON.stringify(currentPresentation()) === JSON.stringify(presentation)
  ) return

  initialized = false
  slidesStore.$patch({
    title: presentation.title,
    theme: structuredClone(presentation.theme),
    slides: structuredClone(presentation.slides),
    slideIndex: 0,
    viewportSize: presentation.viewportSize,
    viewportRatio: presentation.viewportRatio
  })
  if (!mounted) {
    app.mount('#app')
    mounted = true
  }
  await nextTick()
  try {
    await snapshotStore.initSnapshotDatabase()
  } catch (error) {
    post({
      type: 'slidemind:pptist:error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
  initialized = true
}

function failImport(requestId: string, error: unknown): void {
  if (pendingImport?.requestId === requestId) {
    window.clearTimeout(pendingImport.timeout)
    pendingImport = undefined
  }
  post({
    type: 'slidemind:pptist:import-error',
    requestId,
    message: error instanceof Error ? error.message : String(error)
  })
}

async function importPresentation(message: ImportHostMessage): Promise<void> {
  if (
    typeof message.requestId !== 'string' ||
    message.requestId.length === 0 ||
    typeof message.fileName !== 'string' ||
    !message.fileName.toLocaleLowerCase().endsWith('.pptx') ||
    !(message.bytes instanceof ArrayBuffer) ||
    message.bytes.byteLength === 0 ||
    message.bytes.byteLength > MAX_IMPORT_BYTES ||
    !isPresentationState(message.presentation)
  ) {
    failImport(
      typeof message.requestId === 'string' && message.requestId.length > 0
        ? message.requestId
        : 'unknown',
      new Error('PPTX 导入请求无效')
    )
    return
  }
  if (pendingImport) {
    failImport(message.requestId, new Error('已有 PPTX 正在导入'))
    return
  }

  try {
    await loadPresentation(message.presentation)
    await parse(message.bytes.slice(0), {
      imageMode: 'none',
      videoMode: 'none',
      audioMode: 'none'
    })
    pendingImport = {
      requestId: message.requestId,
      timeout: window.setTimeout(() => {
        failImport(message.requestId, new Error('PPTX 导入超时'))
      }, IMPORT_TIMEOUT_MS)
    }
    const file = new File([message.bytes], message.fileName, {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    })
    importPPTXFile([file], { cover: true, fixedViewport: true })
    if (!importing.value) throw new Error('PPTX 导入未能启动')
  } catch (error) {
    failImport(message.requestId, error)
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

async function waitForSlideImages(): Promise<void> {
  const images = [...document.querySelectorAll<HTMLImageElement>('.viewport img')]
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const finish = (): void => resolve()
      image.addEventListener('load', finish, { once: true })
      image.addEventListener('error', finish, { once: true })
      window.setTimeout(finish, 3_000)
    })
  }))
}

async function renderPresentation(message: RenderHostMessage): Promise<void> {
  const presentation = message.presentation
  const presentationValid = presentation === undefined || isPresentationState(presentation)
  const slideCount = presentationValid
    ? presentation?.slides.length ?? slidesStore.slides.length
    : 0
  if (
    typeof message.requestId !== 'string' ||
    !message.requestId ||
    !presentationValid ||
    slideCount === 0 ||
    !Number.isInteger(message.slideNumber) ||
    message.slideNumber < 1 ||
    message.slideNumber > slideCount
  ) {
    post({
      type: 'slidemind:pptist:render-error',
      requestId: typeof message.requestId === 'string' ? message.requestId : 'unknown',
      message: '幻灯片渲染请求无效'
    })
    return
  }

  try {
    document.body.classList.add('slidemind-render-mode')
    if (presentation) await loadPresentation(presentation)
    mainStore.setCanvasPercentage(100)
    slidesStore.updateSlideIndex(message.slideNumber - 1)
    await nextTick()
    await document.fonts.ready
    await waitForSlideImages()
    await nextFrame()
    await nextFrame()
    const viewport = document.querySelector<HTMLElement>('.viewport-wrapper')
    if (!viewport) throw new Error('找不到幻灯片渲染区域')
    const rect = viewport.getBoundingClientRect()
    post({
      type: 'slidemind:pptist:render-ready',
      requestId: message.requestId,
      rect: {
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width
      }
    })
  } catch (error) {
    post({
      type: 'slidemind:pptist:render-error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  if (event.source !== window.parent) return
  if (event.data?.type === 'slidemind:pptist:render') {
    void renderPresentation(event.data)
    return
  }
  if (event.data?.type === 'slidemind:pptist:import') {
    void importPresentation(event.data)
    return
  }
  if (event.data?.type !== 'slidemind:pptist:load') return
  if (!isPresentationState(event.data.presentation)) {
    post({ type: 'slidemind:pptist:error', message: 'PPTist 演示文稿数据无效' })
    return
  }
  void loadPresentation(event.data.presentation)
})

window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's') {
    event.preventDefault()
    if (changeTimer !== undefined) window.clearTimeout(changeTimer)
    changeTimer = undefined
    post({
      type: 'slidemind:pptist:save',
      presentation: currentPresentation()
    })
  }
}, true)

window.addEventListener('error', (event) => {
  if (pendingImport) {
    failImport(pendingImport.requestId, event.error ?? event.message)
    return
  }
  post({ type: 'slidemind:pptist:error', message: event.message || 'PPTist 编辑器运行失败' })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  if (pendingImport) {
    failImport(pendingImport.requestId, reason)
    return
  }
  post({
    type: 'slidemind:pptist:error',
    message: reason instanceof Error ? reason.message : String(reason)
  })
})

watch(importing, async (isImporting, wasImporting) => {
  if (isImporting || !wasImporting || !pendingImport) return
  const completed = pendingImport
  window.clearTimeout(completed.timeout)
  pendingImport = undefined
  await nextTick()
  post({
    type: 'slidemind:pptist:imported',
    requestId: completed.requestId,
    presentation: currentPresentation()
  })
})

watch(
  () => [
    slidesStore.title,
    slidesStore.theme,
    slidesStore.slides,
    slidesStore.viewportSize,
    slidesStore.viewportRatio
  ],
  () => {
    if (!initialized) return
    if (changeTimer !== undefined) window.clearTimeout(changeTimer)
    changeTimer = window.setTimeout(() => {
      post({
        type: 'slidemind:pptist:change',
        presentation: currentPresentation()
      })
    }, 120)
  },
  { deep: true }
)

post({ type: 'slidemind:pptist:ready' })
