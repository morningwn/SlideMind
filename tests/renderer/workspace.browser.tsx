import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { ProjectWorkspace } from '../../src/renderer/src/components/project-workspace'
import { PresentationEditor, type OpenPresentationDocument } from '../../src/renderer/src/components/presentation-editor'
import type { AgentPromptInput, AgentPromptResult, AgentStreamEvent } from '../../src/shared/agent'
import type { ProjectConversationState, ProjectFileChangedEvent, SaveProjectTextFileInput } from '../../src/shared/project'
import { presentationFixture, imageFixture } from './presentation-fixture'
import '../../src/renderer/src/styles.css'
import { persistenceTests } from './conversation-persistence.browser'

// Match the production location so PresentationEditor resolves the real iframe entry.
history.replaceState(null, '', '/src/renderer/index.html')
const root = createRoot(document.getElementById('root')!)
const passed: string[] = []
window.addEventListener('error', (event) => console.error(event.error ?? event.message))
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
async function until(check: () => unknown, message: string, timeout = 20_000): Promise<void> {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${message}`)
    await delay(20)
  }
}
function button(text: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === text)
  assert(match, `Missing button: ${text}`)
  return match
}
function editor(): EditorView {
  const element = document.querySelector('.cm-content')
  assert(element, 'Missing text editor')
  const view = EditorView.findFromDOM(element as HTMLElement)
  assert(view, 'Missing CodeMirror view')
  return view
}
async function editText(text: string): Promise<void> {
  const view = editor()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  await delay(30)
}
let streamListener: ((event: AgentStreamEvent) => void) | undefined
let fileListener: ((event: ProjectFileChangedEvent) => void) | undefined
let request: AgentPromptInput | undefined
let finishPrompt: ((value: AgentPromptResult) => void) | undefined
let content = 'original document'
let revision = 'r1'
let saves = 0
let persisted: ProjectConversationState | undefined
const subscriptions = new Set<string>()
const subscribe = (kind: string) => {
  subscriptions.add(kind)
  return () => { subscriptions.delete(kind) }
}
Object.assign(window, {
  desktop: { platform: 'darwin', reportDiagnosticEvent: () => {} },
  projects: {
    listDirectory: async () => [{ kind: 'file', path: 'notes.txt', name: 'notes.txt' }],
    listFiles: async () => [], watchExternalChanges: async () => {},
    loadConversations: async () => ({ selectedConversationId: 'a', conversations: [{ id: 'a', title: 'Conversation A' }, { id: 'b', title: 'Conversation B' }] }),
    loadConversationMessages: async () => [],
    saveConversations: async (_handle: string, state: ProjectConversationState) => { persisted = structuredClone(state) },
    onFileChanged: (listener: typeof fileListener) => { fileListener = listener; return () => { fileListener = undefined } },
    readTextFile: async () => ({ path: 'notes.txt', kind: 'text', content, revision, lineEnding: 'lf', hasBom: false }),
    saveTextFile: async (_handle: string, input: SaveProjectTextFileInput) => {
      saves += 1
      if (input.revision !== revision) return { ok: false, reason: 'conflict', currentRevision: revision }
      content = input.content
      revision = `r${saves + 1}`
      return { ok: true, revision }
    }
  } satisfies Partial<Window['projects']>,
  presentations: { onChanged: () => () => {} },
  agent: {
    getConfig: async () => ({ configured: false, provider: 'deepseek', providerName: 'DeepSeek', modelId: '', modelName: '', models: [] }),
    listSkills: async () => [], getTodos: async () => [], getUsage: async () => ({ totalTokens: 0, contextTokens: null, contextWindow: null, contextPercent: null }),
    onStream: (listener: typeof streamListener) => { streamListener = listener; const stop = subscribe('stream'); return () => { streamListener = undefined; stop() } },
    onActivity: () => subscribe('activity'), onTodos: () => subscribe('todos'),
    prompt: (input: AgentPromptInput) => { request = input; return new Promise((resolve) => { finishPrompt = resolve }) }
  } satisfies Partial<Window['agent']>
})
window.confirm = () => true

async function workspaceTests(): Promise<void> {
  console.log('[test] workspace start')
  root.render(createElement(ProjectWorkspace, { project: { handle: 'test', name: 'Test project', path: '/test', lastOpenedAt: '' }, onDirtyChange: () => {} }))
  await until(() => document.querySelector('.conversation-item') && document.querySelector('[role="treeitem"]'), 'workspace ready')
  document.querySelector('[role="treeitem"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await until(() => document.querySelector('.cm-content'), 'document open')
  await editText('edited and saved')
  button('保存').click()
  await until(() => content === 'edited and saved' && document.querySelector('[aria-label="notes.txt，已保存"]'), 'document saved')
  document.querySelector<HTMLButtonElement>('[aria-label="关闭 notes.txt"]')!.click()
  await until(() => !document.querySelector('.cm-content'), 'document closed')
  document.querySelector('[role="treeitem"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await until(() => document.querySelector('.cm-content')?.textContent === 'edited and saved', 'document reopened')
  passed.push('React workspace: edit, save, close and reopen a document')

  await editText('local unsaved edit')
  content = 'external edit'
  revision = 'external-r3'
  button('保存').click()
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('其他程序修改'), 'revision conflict')
  assert(editor().state.doc.toString() === 'local unsaved edit', 'Conflict discarded local edit')
  assert(content === 'external edit', 'Conflict overwrote external edit')
  button('重新载入').click()
  await until(() => document.querySelector('.cm-content')?.textContent === 'external edit', 'reload external revision')
  await editText('dirty while external watcher fires')
  content = 'second external edit'
  revision = 'external-r4'
  fileListener?.({ projectHandle: 'test', path: 'notes.txt', kind: 'change', source: 'external' })
  await until(() => document.querySelector('[aria-label="notes.txt，保存冲突"]'), 'external watcher conflict')
  assert(editor().state.doc.toString() === 'dirty while external watcher fires', 'Watcher discarded dirty content')
  passed.push('React workspace: save revision conflict and external watcher preserve dirty content')
  document.querySelector<HTMLButtonElement>('[aria-label="关闭 notes.txt"]')!.click()
  await until(() => !document.querySelector('.cm-content'), 'document closed')

  const textarea = document.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(textarea, 'Generate slides')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await delay(30)
  textarea.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await until(() => request, 'agent started')
  streamListener?.({ conversationId: 'a', requestId: request!.requestId, delta: 'first ' })
  button('Conversation B').click()
  streamListener?.({ conversationId: 'a', requestId: request!.requestId, delta: 'second' })
  await delay(100)
  assert(!document.querySelector('.message-stream')?.textContent?.includes('first second'), 'Stream leaked into selected conversation')
  button('Generate slides').click()
  await until(() => document.querySelector('.message-stream')?.textContent?.includes('first second'), 'originating conversation retains stream')
  finishPrompt!({ text: 'completed output', modelId: 'test' })
  await until(() => document.querySelector('.message-stream')?.textContent?.includes('completed output'), 'agent completion')
  button('Conversation B').click()
  await until(() => persisted?.selectedConversationId === 'b', 'conversation selection persisted')
  assert(!JSON.stringify(persisted).includes('completed output'), 'Messages leaked into metadata persistence')
  passed.push('React workspace: switch conversations during generation; persist metadata only')
  root.render(null)
  await until(() => subscriptions.size === 0, 'agent subscriptions disposed')
  passed.push('Agent hook: unsubscribe all event listeners on unmount')
}

function frameMessage(frame: HTMLIFrameElement, type: string): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error(`Missing iframe event: ${type}`)) }, 30_000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== type) return
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      resolve(event.data)
    }
    window.addEventListener('message', receive)
  })
}

async function presentationTests() {
  console.log('[test] presentation start')
  let model: OpenPresentationDocument = {
    path: 'sample.slides.json', name: 'sample.slides.json', document: presentationFixture(1, imageFixture(64)),
    serializedDocument: '', savedSerializedDocument: '', revision: '1', reloadKey: '1', isSaving: false, isExporting: false, conflict: false, error: ''
  }
  let savedTitle = ''
  const render = () => root.render(createElement(PresentationEditor, {
    document: model,
    onChange: (document) => { model = { ...model, document }; render() },
    onSave: (document) => { savedTitle = document!.presentation.slides[0].elements[0].content as string }, onReload: () => {}
  }))
  render()
  await until(() => document.querySelector('iframe'), 'PPTist frame')
  const frame = document.querySelector('iframe')!
  await until(() => frame.contentDocument?.querySelector('.viewport'), 'real PPTist canvas', 90_000)
  await delay(500)
  const probeReady = frameMessage(frame, 'slidemind:test:probe-ready')
  const script = frame.contentDocument!.createElement('script')
  script.type = 'module'
  script.src = '/tests/renderer/pptist-probe.js'
  frame.contentDocument!.body.append(script)
  await probeReady
  const changed = frameMessage(frame, 'slidemind:pptist:change')
  frame.contentWindow!.postMessage({ type: 'slidemind:test:edit', text: 'Edited inside real Vue store' }, '*')
  await changed
  await until(() => model.document.presentation.slides[0].elements[0].content === '<p>Edited inside real Vue store</p>', 'Vue change reaches React')
  frame.contentWindow!.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
  await until(() => savedTitle.includes('Edited inside real Vue store'), 'Vue save reaches React')
  passed.push('Real React ↔ Vue/PPTist iframe: load, edit, change and save bridge')

  const benchmark = []
  for (const pages of [10, 50, 200]) {
    for (const imageSize of [0, 64, 128]) {
      console.log(`[test] benchmark ${pages} pages, image ${imageSize}`)
      const fixture = presentationFixture(pages, imageSize ? imageFixture(imageSize) : '')
      const rendered = frameMessage(frame, 'slidemind:pptist:render-ready')
      frame.contentWindow!.postMessage({ type: 'slidemind:pptist:render', requestId: `bench-${pages}-${imageSize}`, presentation: fixture.presentation, slideNumber: 1 }, '*')
      await rendered
      await delay(250)
      const samples: Array<Record<string, number>> = []
      for (let index = 0; index < 21; index += 1) {
        const edited = frameMessage(frame, 'slidemind:test:edited')
        const synced = frameMessage(frame, 'slidemind:pptist:change')
        const start = performance.now()
        frame.contentWindow!.postMessage({ type: 'slidemind:test:edit', text: `Benchmark ${index}` }, '*')
        const metrics = await edited
        await synced
        const syncMs = performance.now() - start
        const measured = frameMessage(frame, 'slidemind:test:measured')
        frame.contentWindow!.postMessage({ type: 'slidemind:test:measure', reverse: index % 2 === 0 }, '*')
        const serialization = await measured
        assert(serialization.equal, 'Optimized snapshot differs from original JSON snapshot')
        if (index > 0) samples.push({ ...metrics, ...serialization, syncMs })
      }
      const percentile = (key: string, fraction: number) => {
        const sorted = samples.map((sample) => sample[key as keyof typeof sample] as number).sort((a, b) => a - b)
        return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1] * 100) / 100
      }
      benchmark.push({ pages, imagePixels: imageSize, bytes: samples[0].bytes, samples: samples.length,
        watcherP50Ms: percentile('watcherMs', 0.5), baselineSerializeP50Ms: percentile('baselineSerializationMs', 0.5), serializeP50Ms: percentile('serializationMs', 0.5),
        editFrameP95Ms: percentile('frameMs', 0.95), syncP50Ms: percentile('syncMs', 0.5), syncP95Ms: percentile('syncMs', 0.95) })
    }
  }
  const rendered = frameMessage(frame, 'slidemind:pptist:render-ready')
  frame.contentWindow!.postMessage({ type: 'slidemind:pptist:render', requestId: 'visual', presentation: presentationFixture(1, imageFixture(64)).presentation, slideNumber: 1 }, '*')
  await rendered
  const viewport = frame.contentDocument!.querySelector('.viewport')!
  assert(viewport.textContent?.includes('跨框架渲染验证'), 'Missing rendered Chinese title')
  const images = [...viewport.querySelectorAll('img')]
  assert(images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0), 'PPTist image failed to decode')
  passed.push('Real PPTist: rendered Chinese/English text, emphasis, color and decoded image; screenshot captured')
  return benchmark
}

declare global { interface Window { rendererTestResult: Promise<unknown> } }
window.rendererTestResult = (async () => {
  try {
    passed.push(...await persistenceTests())
    await workspaceTests()
    const benchmark = await presentationTests()
    return { passed, benchmark }
  } catch (error) {
    return { passed, error: error instanceof Error ? error.stack : String(error) }
  }
})()
