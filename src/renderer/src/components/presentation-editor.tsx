import { useEffect, useRef, useState } from 'react'
import type {
  PptistPresentation,
  PresentationDocument
} from '../../../shared/presentation'

export interface OpenPresentationDocument {
  path: string
  name: string
  document: PresentationDocument
  serializedDocument: string
  savedSerializedDocument: string
  revision: string
  reloadKey: string
  isSaving: boolean
  isExporting: boolean
  lastExportPath?: string
  conflict: boolean
  error: string
}

interface PresentationEditorProps {
  document: OpenPresentationDocument
  onChange: (document: PresentationDocument) => void
  onReload: () => void
  onSave: (document?: PresentationDocument) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPptistPresentation(value: unknown): value is PptistPresentation {
  return isRecord(value) &&
    typeof value.title === 'string' &&
    Array.isArray(value.slides) &&
    isRecord(value.theme) &&
    typeof value.viewportSize === 'number' &&
    typeof value.viewportRatio === 'number'
}

export function PresentationEditor({
  document,
  onChange,
  onReload,
  onSave
}: PresentationEditorProps): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const documentRef = useRef(document)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const [setupError, setSetupError] = useState('')
  documentRef.current = document
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  const loadEditor = (): void => {
    frameRef.current?.contentWindow?.postMessage({
      type: 'slidemind:pptist:load',
      presentation: structuredClone(documentRef.current.document.presentation)
    }, '*')
  }

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow
    const receiveMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (!isRecord(event.data) || typeof event.data.type !== 'string') return

      if (event.data.type === 'slidemind:pptist:ready') {
        setSetupError('')
        loadEditor()
        return
      }
      if (event.data.type === 'slidemind:pptist:save') {
        if (!isPptistPresentation(event.data.presentation)) return
        const nextDocument = {
          ...documentRef.current.document,
          presentation: event.data.presentation
        }
        onChangeRef.current(nextDocument)
        onSaveRef.current(nextDocument)
        return
      }
      if (event.data.type === 'slidemind:pptist:error') {
        setSetupError(
          typeof event.data.message === 'string'
            ? event.data.message
            : 'PPTist 编辑器运行失败'
        )
        return
      }
      if (
        event.data.type === 'slidemind:pptist:change' &&
        isPptistPresentation(event.data.presentation)
      ) {
        onChangeRef.current({
          ...documentRef.current.document,
          presentation: event.data.presentation
        })
      }
    }

    window.addEventListener('message', receiveMessage)
    if (frameWindow) loadEditor()
    return () => window.removeEventListener('message', receiveMessage)
  }, [document.path, document.reloadKey])

  const error = document.error || setupError
  const editorUrl = new URL('./pptist.html', window.location.href).toString()
  return (
    <section className="presentation-panel" aria-labelledby="active-presentation-title">
      <h1 id="active-presentation-title" className="sr-only">{document.name}</h1>
      {error ? (
        <div className="document-error" role="alert">
          <span>{error}</span>
          {document.conflict ? <button type="button" onClick={onReload}>重新载入</button> : null}
        </div>
      ) : null}
      <div className="presentation-statusbar">
        <span>{document.lastExportPath ? `已导出：${document.lastExportPath}` : 'PPTist · 1000 × 562.5'}</span>
      </div>
      <iframe
        className="presentation-pptist-frame"
        ref={frameRef}
        src={editorUrl}
        title={`${document.name} PPTist 编辑器`}
        onLoad={loadEditor}
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </section>
  )
}
