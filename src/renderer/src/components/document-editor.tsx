import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { basicSetup } from 'codemirror'
import type { ProjectTextFileKind } from '../../../shared/project'
import type { DocumentExportWarning } from '../../../shared/document-export'
import { renderMarkdownHtml } from '../lib/markdown-html'

export type MarkdownViewMode = 'edit' | 'split' | 'preview'

export interface OpenTextDocument {
  path: string
  name: string
  kind: ProjectTextFileKind
  content: string
  savedContent: string
  revision: string
  lineEnding: 'lf' | 'crlf'
  hasBom: boolean
  isSaving: boolean
  isExporting: boolean
  conflict: boolean
  error: string
  exportError: string
  lastExportPath?: string
  exportWarnings: DocumentExportWarning[]
  viewMode: MarkdownViewMode
}

interface DocumentEditorProps {
  document: OpenTextDocument
  onChange: (content: string) => void
  onReload: () => void
  onSave: () => void
  projectHandle: string
}

const exportWarningLabels: Record<DocumentExportWarning, string> = {
  mermaid_not_rendered: 'Mermaid 图表按代码文本导出',
  unsupported_link_removed: '不支持的链接协议已转为普通文本'
}

interface SourceEditorProps {
  ariaLabel: string
  kind: ProjectTextFileKind
  lineEnding: 'lf' | 'crlf'
  onChange: (content: string) => void
  onSave: () => void
  value: string
}

function SourceEditor({
  ariaLabel,
  kind,
  lineEnding,
  onChange,
  onSave,
  value
}: SourceEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!hostRef.current) return

    const extensions = [
      basicSetup,
      EditorState.lineSeparator.of(lineEnding === 'crlf' ? '\r\n' : '\n'),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
      }),
      keymap.of([{
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSaveRef.current()
          return true
        }
      }]),
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent' },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          fontSize: '12px',
          lineHeight: '1.7'
        },
        '.cm-content': { padding: '22px 0 64px' },
        '.cm-line': { padding: '0 22px' },
        '.cm-gutters': {
          backgroundColor: '#f8fafe',
          borderRight: '1px solid #e5eaf2',
          color: '#9aa5b5'
        },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#eef3ff' },
        '&.cm-focused': { outline: 'none' },
        '&.cm-focused .cm-cursor': { borderLeftColor: '#2f61e9' },
        '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: '#dce7ff' }
      })
    ]
    if (kind === 'markdown') extensions.push(markdown())

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current
    })
    editorRef.current = view
    return () => {
      editorRef.current = null
      view.destroy()
    }
  }, [ariaLabel, kind, lineEnding])

  useEffect(() => {
    const view = editorRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  return <div className="source-editor" ref={hostRef} />
}

function MarkdownPreview({
  documentPath,
  projectHandle,
  source
}: {
  documentPath: string
  projectHandle: string
  source: string
}): React.JSX.Element {
  const deferredSource = useDeferredValue(source)
  const previewRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdownHtml(deferredSource), [deferredSource])

  useEffect(() => {
    let active = true
    const images = previewRef.current?.querySelectorAll<HTMLImageElement>('img[data-project-source]')
    for (const image of images ?? []) {
      const sourcePath = image.dataset.projectSource
      if (!sourcePath) continue
      void window.projects
        .readPreviewAsset(projectHandle, documentPath, sourcePath)
        .then((dataUrl) => {
          if (active) image.src = dataUrl
        })
        .catch(() => {
          if (!active) return
          const fallback = window.document.createElement('span')
          fallback.className = 'markdown-image-error'
          fallback.textContent = image.alt
            ? `无法载入图片：${image.alt}`
            : '无法载入 Markdown 图片'
          image.replaceWith(fallback)
        })
    }
    return () => {
      active = false
    }
  }, [documentPath, html, projectHandle])

  function handlePreviewClick(event: React.MouseEvent<HTMLDivElement>): void {
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest('a')
    if (!link) return
    event.preventDefault()
    const href = link.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="markdown-preview-scroll" onClick={handlePreviewClick} ref={previewRef}>
      {deferredSource.trim() ? (
        <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="markdown-preview-empty">
          <span aria-hidden="true">Aa</span>
          <p>开始输入后，这里会呈现 Markdown 预览。</p>
        </div>
      )}
    </div>
  )
}

export function DocumentEditor({
  document,
  onChange,
  onReload,
  onSave,
  projectHandle
}: DocumentEditorProps): React.JSX.Element {
  const [splitPercent, setSplitPercent] = useState(50)
  const splitRef = useRef<HTMLDivElement>(null)

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (document.viewMode !== 'split') return
    event.preventDefault()
    const container = splitRef.current
    if (!container) return

    function resize(pointerEvent: PointerEvent): void {
      const bounds = container?.getBoundingClientRect()
      if (!bounds) return
      const percent = ((pointerEvent.clientX - bounds.left) / bounds.width) * 100
      setSplitPercent(Math.min(68, Math.max(32, percent)))
    }

    function finishResize(): void {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', finishResize)
    }

    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', finishResize)
  }

  function adjustSplit(direction: -1 | 1): void {
    setSplitPercent((current) => Math.min(68, Math.max(32, current + direction * 4)))
  }

  return (
    <section className="document-panel" aria-labelledby="active-document-title">
      <h1 id="active-document-title" className="sr-only">{document.name}</h1>

      {document.error ? (
        <div className="document-error" role="alert">
          <span>{document.error}</span>
          {document.conflict ? <button type="button" onClick={onReload}>重新载入</button> : null}
        </div>
      ) : null}

      {document.exportError ? (
        <div className="document-error" role="alert">
          <span>{document.exportError}</span>
        </div>
      ) : document.lastExportPath ? (
        <div className="document-export-result" role="status">
          <span>已导出点击时的内容快照：{document.lastExportPath}</span>
          {document.exportWarnings.length > 0 ? (
            <small>{document.exportWarnings.map((warning) => exportWarningLabels[warning]).join('；')}</small>
          ) : null}
        </div>
      ) : null}

      {document.kind === 'markdown' ? (
        <div
          className={`markdown-workbench markdown-workbench-${document.viewMode}`}
          ref={splitRef}
          style={{ '--editor-split': `${splitPercent}%` } as React.CSSProperties}
        >
          <section className="document-source-pane" aria-label="Markdown 编辑">
            <div className="document-pane-label"><span>Markdown</span><small>源码</small></div>
            <SourceEditor
              ariaLabel={`${document.name} Markdown 源码`}
              kind={document.kind}
              lineEnding={document.lineEnding}
              onChange={onChange}
              onSave={onSave}
              value={document.content}
            />
          </section>
          {document.viewMode === 'split' ? (
            <button
              className="markdown-split-handle"
              type="button"
              role="separator"
              aria-label="调整编辑与预览宽度"
              aria-orientation="vertical"
              aria-valuemin={32}
              aria-valuemax={68}
              aria-valuenow={Math.round(splitPercent)}
              onPointerDown={beginResize}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') adjustSplit(-1)
                if (event.key === 'ArrowRight') adjustSplit(1)
              }}
            ><i /></button>
          ) : null}
          <section className="document-preview-pane" aria-label="Markdown 预览">
            <div className="document-pane-label"><span>Preview</span><small>预览</small></div>
            <MarkdownPreview
              documentPath={document.path}
              projectHandle={projectHandle}
              source={document.content}
            />
          </section>
        </div>
      ) : (
        <div className="text-workbench">
          <SourceEditor
            ariaLabel={`${document.name} 文本内容`}
            kind={document.kind}
            lineEnding={document.lineEnding}
            onChange={onChange}
            onSave={onSave}
            value={document.content}
          />
        </div>
      )}
    </section>
  )
}
