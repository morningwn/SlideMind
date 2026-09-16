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
let exportAttempt = 0
const exportSnapshots: Array<{ path: string; content: string }> = []
let finishExport: ((value: Awaited<ReturnType<Window['documentExport']['exportWord']>>) => void) | undefined
let persisted: ProjectConversationState | undefined
const subscriptions = new Set<string>()
const subscribe = (kind: string) => {
  subscriptions.add(kind)
  return () => { subscriptions.delete(kind) }
}
Object.assign(window, {
  desktop: { platform: 'darwin', reportDiagnosticEvent: () => {} },
  projects: {
    listDirectory: async (_handle, path) => path === 'assets'
      ? [{ kind: 'file', path: 'assets/child.txt', name: 'child.txt' }]
      : [{ kind: 'file', path: 'notes.txt', name: 'notes.txt' }, { kind: 'directory', path: 'assets', name: 'assets' }, { kind: 'file', path: 'guide.md', name: 'guide.md' }],
    listFiles: async () => [], watchExternalChanges: async () => {},
    loadConversations: async () => ({ selectedConversationId: 'a', conversations: [{ id: 'a', title: 'Conversation A' }, { id: 'b', title: 'Conversation B' }] }),
    loadConversationMessages: async () => [],
    saveConversations: async (_handle: string, state: ProjectConversationState) => { persisted = structuredClone(state) },
    onFileChanged: (listener: typeof fileListener) => { fileListener = listener; return () => { fileListener = undefined } },
    readTextFile: async (_handle, path) => path === 'guide.md'
      ? { path, kind: 'markdown', content: '# Draft', revision: 'markdown-r1', lineEnding: 'lf', hasBom: false }
      : { path: 'notes.txt', kind: 'text', content, revision, lineEnding: 'lf', hasBom: false },
    saveTextFile: async (_handle: string, input: SaveProjectTextFileInput) => {
      saves += 1
      if (input.revision !== revision) return { ok: false, reason: 'conflict', currentRevision: revision }
      content = input.content
      revision = `r${saves + 1}`
      return { ok: true, revision }
    }
  } satisfies Partial<Window['projects']>,
  documentExport: {
    exportWord: async (_handle, input) => {
      exportAttempt += 1
      exportSnapshots.push(structuredClone(input))
      if (exportAttempt === 1) return { status: 'canceled' }
      if (exportAttempt === 3) return { status: 'failed', code: 'conversion_failed', message: '模拟转换失败' }
      if (exportAttempt === 4) return { status: 'exported', outputPath: '/tmp/guide-retry.docx', warnings: [] }
      return new Promise((resolve) => { finishExport = resolve })
    }
  } satisfies Window['documentExport'],
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
  const key = (element: Element, value: string): void => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
  }
  const firstFile = document.querySelector<HTMLButtonElement>('[role="treeitem"]')!
  firstFile.focus()
  key(firstFile, 'ArrowDown')
  await until(() => document.activeElement?.textContent?.includes('assets'), 'tree next item')
  const folder = document.activeElement!
  key(folder, 'ArrowRight')
  await until(() => document.querySelectorAll('[role="treeitem"]').length === 4, 'tree folder expanded')
  key(folder, 'ArrowRight')
  await until(() => document.activeElement?.textContent?.includes('child.txt'), 'tree child focus')
  key(document.activeElement!, 'ArrowLeft')
  assert(document.activeElement === folder, 'Tree left arrow did not focus parent')
  key(folder, 'ArrowLeft')
  await until(() => document.querySelectorAll('[role="treeitem"]').length === 3, 'tree folder collapsed')
  assert(document.querySelectorAll('[role="treeitem"][tabindex="0"]').length === 1, 'Tree needs a single tab stop')
  const sidebar = document.querySelector<HTMLElement>('.project-sidebar')!
  document.querySelector<HTMLButtonElement>('[aria-label="收起侧栏"]')!.click()
  await until(() => sidebar.hidden, 'sidebar collapsed')
  document.querySelector<HTMLButtonElement>('[aria-label="展开侧栏"]')!.click()
  await until(() => !sidebar.hidden, 'sidebar expanded')
  const widthHandle = document.querySelector('[aria-label="调整侧栏宽度"]')!
  key(widthHandle, 'End')
  await until(() => widthHandle.getAttribute('aria-valuenow') === widthHandle.getAttribute('aria-valuemax'), 'sidebar upper bound')
  key(widthHandle, 'Home')
  await until(() => sidebar.getBoundingClientRect().width === 220, 'sidebar lower bound')
  const heightHandle = document.querySelector('[aria-label="调整对话与文件区域高度"]')!
  key(heightHandle, 'Home')
  await until(() => heightHandle.getAttribute('aria-valuenow') === '120', 'conversation lower bound')
  key(heightHandle, 'ArrowDown')
  await until(() => heightHandle.getAttribute('aria-valuenow') === '130', 'keyboard pane resizing')
  const trigger = document.querySelector<HTMLButtonElement>('.file-create-trigger')!
  trigger.focus()
  key(trigger, 'ArrowDown')
  await until(() => document.activeElement?.textContent === '新建文件夹', 'menu initial focus')
  const menuBounds = document.querySelector('[role="menu"]')!.getBoundingClientRect()
  const sidebarBounds = sidebar.getBoundingClientRect()
  assert(menuBounds.left >= sidebarBounds.left && menuBounds.right <= sidebarBounds.right, 'Menu clipped in narrow sidebar')
  key(document.activeElement!, 'End')
  assert(document.activeElement?.textContent === '新建 Markdown 文档', 'Menu End did not select last item')
  key(document.activeElement!, 'ArrowDown')
  assert(String(document.activeElement?.textContent) === '新建文件夹', 'Menu navigation did not wrap')
  key(document.activeElement!, 'Escape')
  await until(() => !document.querySelector('[role="menu"]') && document.activeElement === trigger, 'menu focus restored')
  const composer = document.querySelector('textarea')!
  const setDraft = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setDraft.call(composer, Array(20).fill('Long message line').join('\n'))
  composer.dispatchEvent(new Event('input', { bubbles: true }))
  await until(() => composer.clientHeight === 150, 'composer grows to maximum')
  assert(composer.scrollHeight > composer.clientHeight, 'Long composer does not scroll')
  setDraft.call(composer, '')
  composer.dispatchEvent(new Event('input', { bubbles: true }))
  await until(() => composer.clientHeight === 62, 'composer shrinks after clearing')
  const workspace = document.querySelector<HTMLElement>('.project-workspace')!
  workspace.style.width = '900px'
  workspace.style.height = '574px'
  workspace.style.flexShrink = '0'
  key(widthHandle, 'End')
  await until(() => widthHandle.getAttribute('aria-valuemax') === '360', 'sidebar adapts to minimum window')
  await delay(50)
  const send = document.querySelector<HTMLElement>('.composer-send')!.getBoundingClientRect()
  const bounds = workspace.getBoundingClientRect()
  assert(send.right <= bounds.right && send.bottom <= bounds.bottom, 'Composer actions overflow the minimum window')
  workspace.style.width = ''
  workspace.style.height = ''
  workspace.style.flexShrink = ''
  passed.push('Workspace controls: sidebar collapse and bounds, minimum window, tree/menu/tab keyboard navigation and growing composer')
  document.querySelector('[role="treeitem"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await until(() => document.querySelector('.cm-content'), 'document open')
  const activeTab = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!
  key(activeTab, 'Home')
  await until(() => document.querySelector('textarea'), 'keyboard switches to chat tab')
  key(document.activeElement!, 'End')
  await until(() => document.querySelector('.cm-content'), 'keyboard switches to document tab')
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

  document.querySelector<HTMLButtonElement>('[aria-label="编辑 Markdown 文档 guide.md"]')!.click()
  await until(() => document.querySelector('[aria-label="guide.md Markdown 源码"]'), 'markdown opened')
  button('导出 Word').click()
  await until(() => exportAttempt === 1 && button('导出 Word'), 'export cancellation settled')
  await editText('# Snapshot before later edit')
  const savesBeforeExport = saves
  button('导出 Word').click()
  await until(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === '导出中…')?.disabled, 'markdown export started')
  await editText('# Continued editing during export')
  assert(exportSnapshots[1].content === '# Snapshot before later edit', 'Word export did not capture the click-time snapshot')
  assert(saves === savesBeforeExport, 'Word export saved the Markdown source unexpectedly')
  finishExport?.({ status: 'exported', outputPath: '/tmp/guide.docx', warnings: ['mermaid_not_rendered'] })
  await until(() => document.querySelector('[role="status"]')?.textContent?.includes('/tmp/guide.docx'), 'markdown export success')
  assert(document.querySelector('[role="status"]')?.textContent?.includes('Mermaid'), 'Word export warning was not shown')
  assert(editor().state.doc.toString() === '# Continued editing during export', 'Export completion replaced later edits')
  assert(document.querySelector('[aria-label="guide.md，未保存"]'), 'Word export marked the source as saved')
  button('导出 Word').click()
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('模拟转换失败'), 'markdown export failure')
  button('导出 Word').click()
  await until(() => document.querySelector('[role="status"]')?.textContent?.includes('guide-retry.docx'), 'markdown export retry')
  await delay(250)
  document.title = 'SlideMind renderer tests - markdown export ready'
  await delay(50)
  passed.push('Markdown Word export: cancellation, click-time snapshot, concurrent editing, warnings and failure retry')
  document.querySelector<HTMLButtonElement>('[aria-label="关闭 guide.md"]')!.click()
  await until(() => !document.querySelector('.cm-content'), 'markdown closed')

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
