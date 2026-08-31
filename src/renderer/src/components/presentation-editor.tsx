import { getColorStyle, LocaleType, mergeLocales, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import DesignZhCN from '@univerjs/design/locale/zh-CN'
import { UniverDocsPlugin } from '@univerjs/docs'
import { UniverDocsUIPlugin } from '@univerjs/docs-ui'
import DocsUIZhCN from '@univerjs/docs-ui/locale/zh-CN'
import { UniverDrawingPlugin } from '@univerjs/drawing'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { SlideDataModel, UniverSlidesPlugin, type ISlideData } from '@univerjs/slides'
import {
  ISlideEditorBridgeService,
  UpdateSlideElementOperation,
  UniverSlidesUIPlugin
} from '@univerjs/slides-ui'
import SlidesUIZhCN from '@univerjs/slides-ui/locale/zh-CN'
import { UniverUIPlugin } from '@univerjs/ui'
import UIZhCN from '@univerjs/ui/locale/zh-CN'
import { useEffect, useRef, useState } from 'react'
import type { PresentationDocument } from '../../../shared/presentation'

import '@univerjs/design/lib/index.css'
import '@univerjs/ui/lib/index.css'
import '@univerjs/docs-ui/lib/index.css'
import '@univerjs/slides-ui/lib/index.css'

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
  onExport: () => void
  onReload: () => void
  onSave: () => void
}

export function PresentationEditor({
  document,
  onChange,
  onExport,
  onReload,
  onSave
}: PresentationEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const [setupError, setSetupError] = useState('')
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let univer: Univer | undefined
    let changeTimer: number | undefined
    let closeTextEditor: (() => void) | undefined
    let active = true
    let ready = false
    let lastSerializedSnapshot = JSON.stringify(document.document.snapshot)

    try {
      setSetupError('')
      univer = new Univer({
        locale: LocaleType.ZH_CN,
        locales: {
          [LocaleType.ZH_CN]: mergeLocales(
            DesignZhCN,
            UIZhCN,
            DocsUIZhCN,
            SlidesUIZhCN
          )
        }
      })
      univer.registerPlugin(UniverRenderEnginePlugin)
      univer.registerPlugin(UniverUIPlugin, {
        container: host,
        header: true,
        headerMenu: false,
        footer: false,
        toolbar: true
      })
      univer.registerPlugin(UniverDocsPlugin)
      univer.registerPlugin(UniverDocsUIPlugin)
      univer.registerPlugin(UniverDrawingPlugin)
      univer.registerPlugin(UniverSlidesPlugin)
      univer.registerPlugin(UniverSlidesUIPlugin)

      const model = univer.createUnit<ISlideData, SlideDataModel>(
        UniverInstanceType.UNIVER_SLIDE,
        structuredClone(document.document.snapshot)
      )
      const univerApi = FUniver.newAPI(univer)
      const injector = univer.__getInjector()
      const editorBridge = injector.get(ISlideEditorBridgeService)
      const nativeEditorSelector = [
        '.univer-absolute',
        '.univer-z-10',
        '.univer-box-border',
        '.univer-flex'
      ].join('')

      const positionInlineEditor = (
        input: HTMLTextAreaElement,
        editorRect: ReturnType<typeof editorBridge.getEditorRect>
      ): boolean => {
        const hostBounds = host.getBoundingClientRect()
        const nativeEditor = host.querySelector<HTMLElement>(nativeEditorSelector)
        const nativeBounds = nativeEditor?.getBoundingClientRect()

        if (
          nativeBounds &&
          nativeBounds.width > 4 &&
          nativeBounds.height > 4 &&
          nativeBounds.right > hostBounds.left &&
          nativeBounds.bottom > hostBounds.top
        ) {
          input.style.left = `${nativeBounds.left - hostBounds.left}px`
          input.style.top = `${nativeBounds.top - hostBounds.top}px`
          input.style.width = `${nativeBounds.width}px`
          input.style.height = `${nativeBounds.height}px`
          return true
        }

        const editState = editorBridge.getEditRectState()
        if (!editState) return false
        const canvas = editorRect.engine.getCanvasElement()
        const canvasBounds = canvas.getBoundingClientRect()
        const canvasStyleWidth = Number.parseFloat(canvas.style.width)
        const scaleAdjust = canvasStyleWidth > 0 ? canvasBounds.width / canvasStyleWidth : 1
        const { position, slideCardOffset } = editState
        input.style.left = `${canvasBounds.left - hostBounds.left +
          (position.startX + slideCardOffset.left) * scaleAdjust}px`
        input.style.top = `${canvasBounds.top - hostBounds.top +
          (position.startY + slideCardOffset.top) * scaleAdjust}px`
        input.style.width = `${(position.endX - position.startX) * scaleAdjust}px`
        input.style.height = `${(position.endY - position.startY) * scaleAdjust}px`
        return false
      }

      const openTextEditor = (
        editorRect: ReturnType<typeof editorBridge.getEditorRect>,
        hideNativeEditor?: () => void
      ): void => {
        if (!active || !editorRect) return
        closeTextEditor?.()
        const richText = editorRect.richTextObj
        const transformer = richText.getScene()?.getTransformer()
        if (!transformer) {
          setSetupError('无法开始当前文本编辑，请重新打开演示文稿后再试')
          return
        }
        const input = window.document.createElement('textarea')
        input.className = 'presentation-inline-text-editor'
        input.value = richText.text
        input.setAttribute('aria-label', '编辑幻灯片文本')
        input.spellcheck = false

        const snapshot = model.getSnapshot()
        const page = snapshot.body?.pages[editorRect.pageId]
        const element = page?.pageElements[richText.oKey]
        const richTextStyle = element && 'richText' in element ? element.richText : undefined
        const canvas = editorRect.engine.getCanvasElement()
        const canvasBounds = canvas.getBoundingClientRect()
        const canvasStyleWidth = Number.parseFloat(canvas.style.width)
        const scaleAdjust = canvasStyleWidth > 0 ? canvasBounds.width / canvasStyleWidth : 1
        const fontSize = (richTextStyle?.fs ?? richText.fs) * scaleAdjust
        const color = getColorStyle(richTextStyle?.cl)
        input.style.fontSize = `${fontSize}px`
        input.style.fontWeight = richTextStyle?.bl ? '700' : '400'
        input.style.fontStyle = richTextStyle?.it ? 'italic' : 'normal'
        if (color) input.style.color = color
        if (richTextStyle?.ff) input.style.fontFamily = richTextStyle.ff
        if (richText.angle) input.style.transform = `rotate(${richText.angle}deg)`

        host.appendChild(input)
        positionInlineEditor(input, editorRect)
        richText.hide()

        let destroyed = false
        let positionFrame = 0
        const cleanup = (): void => {
          if (destroyed) return
          destroyed = true
          input.onblur = null
          input.onkeydown = null
          closeTextEditor = undefined
          window.cancelAnimationFrame(positionFrame)
          input.remove()
          richText.show()
        }
        closeTextEditor = cleanup

        const finish = async (commit: boolean, restoreSelection = false): Promise<void> => {
          if (destroyed) return
          const text = input.value
          const previousText = richText.text

          // Model updates can move focus and dispatch blur again. Destroy the DOM editor
          // before ending Univer's edit session to prevent a recursive submit path.
          cleanup()
          if (!active) return

          // End Univer's hidden native session first. It otherwise remains focused and can
          // intercept the next double-click or overwrite the custom editor's document data.
          transformer.clearControls()
          if (restoreSelection) transformer.activeAnObject(richText)
          if (!commit || text === previousText) return
          if (!element || !('richText' in element) || !element.richText) {
            setSetupError('无法定位当前文本对象，请重新打开演示文稿后再试')
            return
          }

          const body = richText.documentData.body
          if (body) {
            const textRun = body.textRuns?.[0]
            body.dataStream = `${text}\r\n`
            body.textRuns = [{ ...textRun, st: 0, ed: text.length }]
            body.paragraphs = undefined
            body.sectionBreaks = undefined
            richText.refreshDocumentByDocData()
            richText.resizeToContentSize()
          }

          const updated = await univerApi.executeCommand(UpdateSlideElementOperation.id, {
            unitId: model.getUnitId(),
            oKey: richText.oKey,
            props: {
              richText: {
                ...element.richText,
                text
              }
            }
          })
          if (!updated && active) setSetupError('文本修改失败，请重新打开演示文稿后再试')
        }

        input.onblur = () => void finish(true)
        input.onkeydown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            void finish(false, true)
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void finish(true)
          }
        }

        let positionAttempts = 0
        const syncPosition = (): void => {
          if (destroyed || !active) return
          positionAttempts += 1
          const foundNativeEditor = positionInlineEditor(input, editorRect)
          if (!foundNativeEditor && positionAttempts < 4) {
            positionFrame = window.requestAnimationFrame(syncPosition)
            return
          }
          hideNativeEditor?.()
          richText.hide()
          positionFrame = window.requestAnimationFrame(() => {
            if (destroyed || !active) return
            input.focus({ preventScroll: true })
            input.setSelectionRange(input.value.length, input.value.length)
          })
        }
        positionFrame = window.requestAnimationFrame(syncPosition)
      }
      const editorVisibilitySubscription = editorBridge.visible$.subscribe((visibility) => {
        if (!active || !visibility.visible) return
        const editorRect = editorBridge.getEditorRect()
        if (!editorRect) return
        openTextEditor(editorRect, () => {
          editorBridge.changeVisible({ ...visibility, visible: false })
        })
      })
      const commandSubscription = univerApi.onCommandExecuted(() => {
        if (!ready || !active) return
        if (changeTimer !== undefined) window.clearTimeout(changeTimer)
        changeTimer = window.setTimeout(() => {
          if (!active) return
          const serializedSnapshot = JSON.stringify(model.getSnapshot())
          if (serializedSnapshot === lastSerializedSnapshot) return
          lastSerializedSnapshot = serializedSnapshot
          onChangeRef.current({
            ...document.document,
            snapshot: JSON.parse(serializedSnapshot) as ISlideData
          })
        }, 120)
      })
      queueMicrotask(() => {
        ready = true
      })

      return () => {
        active = false
        if (changeTimer !== undefined) window.clearTimeout(changeTimer)
        closeTextEditor?.()
        commandSubscription.dispose()
        editorVisibilitySubscription.unsubscribe()
        univerApi.dispose()
        univer?.dispose()
        host.replaceChildren()
      }
    } catch (error) {
      univer?.dispose()
      host.replaceChildren()
      setSetupError(error instanceof Error ? error.message : '无法初始化 Univer Slides')
    }
  }, [document.path, document.reloadKey])

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        onSaveRef.current()
      }
    }
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [])

  const error = document.error || setupError
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
        <span>{document.lastExportPath ? `已导出：${document.lastExportPath}` : 'Univer Slides · 960 × 540'}</span>
        <div>
          <button
            type="button"
            onClick={onExport}
            disabled={document.isExporting || document.conflict}
          >{document.isExporting ? '导出中…' : '导出 PPTX'}</button>
        </div>
      </div>
      <div className="presentation-univer-host" ref={hostRef} />
    </section>
  )
}
