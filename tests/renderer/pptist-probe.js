// Loaded only by the browser test harness into the real PPTist frame.
import { useSlidesStore } from '@/store'
import { nextTick } from 'vue'
import { serializePptistPresentation } from '/src/renderer/pptist-snapshot.ts'

const store = useSlidesStore()
window.addEventListener('message', async (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type === 'slidemind:test:edit') {
    const start = performance.now()
    store.slides[0].elements[0].content = `<p>${event.data.text}</p>`
    await nextTick()
    const watcherMs = performance.now() - start
    requestAnimationFrame(() => window.parent.postMessage({
      type: 'slidemind:test:edited', watcherMs, frameMs: performance.now() - start
    }, '*'))
  }
  if (event.data?.type === 'slidemind:test:measure') {
    const presentation = {
      title: store.title, theme: store.theme, slides: store.slides,
      viewportSize: store.viewportSize, viewportRatio: store.viewportRatio
    }
    const measure = (serialize) => {
      const start = performance.now()
      const snapshot = JSON.parse(serialize(presentation))
      return { ms: performance.now() - start, snapshot }
    }
    const baseline = () => measure(JSON.stringify)
    const optimized = () => measure(serializePptistPresentation)
    const [before, after] = event.data.reverse
      ? (() => { const after = optimized(); return [baseline(), after] })()
      : [baseline(), optimized()]
    window.parent.postMessage({
      type: 'slidemind:test:measured',
      baselineSerializationMs: before.ms, serializationMs: after.ms,
      bytes: new TextEncoder().encode(JSON.stringify(after.snapshot)).length,
      equal: JSON.stringify(before.snapshot) === JSON.stringify(after.snapshot)
    }, '*')
  }
})
window.parent.postMessage({ type: 'slidemind:test:probe-ready' }, '*')
