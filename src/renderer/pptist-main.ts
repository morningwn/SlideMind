import { createApp, nextTick, watch } from 'vue'
import { createPinia } from 'pinia'
import Editor from './pptist-editor.vue'
import Directive from '@/directive'
import { useSlidesStore, useSnapshotStore } from '@/store'

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

type HostMessage = {
  type: 'slidemind:pptist:load'
  presentation: PresentationState
}

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
const app = createApp(Editor)
app.use(Directive)
app.use(pinia)

const slidesStore = useSlidesStore(pinia)
const snapshotStore = useSnapshotStore(pinia)
let initialized = false
let changeTimer: number | undefined
let mounted = false

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

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  if (event.source !== window.parent) return
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
  post({ type: 'slidemind:pptist:error', message: event.message || 'PPTist 编辑器运行失败' })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  post({
    type: 'slidemind:pptist:error',
    message: reason instanceof Error ? reason.message : String(reason)
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
