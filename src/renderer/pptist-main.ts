import { createApp, nextTick, watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { parse } from 'pptxtojson'
import Editor from './pptist-editor.vue'
import Directive from '@/directive'
import { useSlidesStore, useSnapshotStore } from '@/store'
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

type HostMessage = LoadHostMessage | ImportHostMessage

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

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  if (event.source !== window.parent) return
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
