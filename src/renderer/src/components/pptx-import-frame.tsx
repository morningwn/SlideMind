import { useEffect, useRef } from 'react'
import {
  PRESENTATION_FORMAT,
  PRESENTATION_FORMAT_VERSION,
  type PptistPresentation,
  type PresentationDocument
} from '../../../shared/presentation'

export interface PptxImportRequest {
  id: string
  bytes: ArrayBuffer
  fileName: string
  path: string
  title: string
}

interface PptxImportFrameProps {
  request: PptxImportRequest
  onError: (requestId: string, message: string) => void
  onImported: (requestId: string, document: PresentationDocument) => void
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

function blankPresentation(title: string): PptistPresentation {
  return {
    title,
    viewportSize: 1000,
    viewportRatio: 0.5625,
    theme: {
      themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
      fontColor: '#333333',
      fontName: '',
      backgroundColor: '#ffffff',
      shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
      outline: { width: 2, color: '#525252', style: 'solid' }
    },
    slides: [{ id: crypto.randomUUID(), elements: [] }]
  }
}

export function PptxImportFrame({
  request,
  onError,
  onImported
}: PptxImportFrameProps): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const sentRequestIdRef = useRef<string | null>(null)
  const onErrorRef = useRef(onError)
  const onImportedRef = useRef(onImported)
  onErrorRef.current = onError
  onImportedRef.current = onImported

  const startImport = (): void => {
    const frameWindow = frameRef.current?.contentWindow
    if (!frameWindow || sentRequestIdRef.current === request.id) return
    sentRequestIdRef.current = request.id
    frameWindow.postMessage({
      type: 'slidemind:pptist:import',
      requestId: request.id,
      fileName: request.fileName,
      bytes: request.bytes,
      presentation: blankPresentation(request.title)
    }, '*', [request.bytes])
  }

  useEffect(() => {
    const receiveMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow || !isRecord(event.data)) return
      if (event.data.type === 'slidemind:pptist:ready') {
        startImport()
        return
      }
      if (
        event.data.type === 'slidemind:pptist:imported' &&
        event.data.requestId === request.id &&
        isPptistPresentation(event.data.presentation)
      ) {
        onImportedRef.current(request.id, {
          format: PRESENTATION_FORMAT,
          version: PRESENTATION_FORMAT_VERSION,
          presentation: event.data.presentation
        })
        return
      }
      if (
        event.data.type === 'slidemind:pptist:import-error' &&
        event.data.requestId === request.id
      ) {
        const message = typeof event.data.message === 'string'
          ? event.data.message
          : '无法导入 PPTX 文件'
        onErrorRef.current(request.id, message)
      }
    }

    window.addEventListener('message', receiveMessage)
    return () => window.removeEventListener('message', receiveMessage)
  }, [request.id])

  const editorUrl = new URL('./pptist.html', window.location.href).toString()
  return (
    <div className="pptx-import-frame" aria-hidden="true">
      <iframe
        ref={frameRef}
        src={editorUrl}
        title="PPTX 导入处理器"
        tabIndex={-1}
        onLoad={startImport}
      />
    </div>
  )
}
