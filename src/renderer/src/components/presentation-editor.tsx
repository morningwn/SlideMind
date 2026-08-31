import { LocaleType, mergeLocales, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import DesignZhCN from '@univerjs/design/locale/zh-CN'
import { UniverDocsPlugin } from '@univerjs/docs'
import { UniverDocsUIPlugin } from '@univerjs/docs-ui'
import DocsUIZhCN from '@univerjs/docs-ui/locale/zh-CN'
import { UniverDrawingPlugin } from '@univerjs/drawing'
import {
  ObjectType,
  UniverRenderEnginePlugin,
  type RichText
} from '@univerjs/engine-render'
import { SlideDataModel, UniverSlidesPlugin, type ISlideData } from '@univerjs/slides'
import {
  CanvasView,
  ISlideEditorBridgeService,
  UniverSlidesUIPlugin,
  UpdateSlideElementOperation
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
  const editSelectedTextRef = useRef<() => void>(() => undefined)
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
      const canvasView = injector.get(CanvasView)
      let lastTextEditorRect: ReturnType<typeof editorBridge.getEditorRect> | undefined
      const openTextEditor = (
        editorRect: ReturnType<typeof editorBridge.getEditorRect>,
        hideNativeEditor?: () => void
      ): void => {
        if (!active || !editorRect) return
        lastTextEditorRect = editorRect
        closeTextEditor?.()
        const richText = editorRect.richTextObj
        richText.show()
        hideNativeEditor?.()

        const overlay = window.document.createElement('div')
        overlay.className = 'presentation-text-editor'
        overlay.style.setProperty('width', 'min(520px, calc(100% - 36px))', 'important')
        overlay.style.setProperty('height', 'auto', 'important')
        overlay.setAttribute('role', 'dialog')
        overlay.setAttribute('aria-label', '编辑幻灯片文本')

        const label = window.document.createElement('label')
        label.textContent = '编辑文本'

        const input = window.document.createElement('textarea')
        input.value = richText.text
        input.rows = 3
        input.setAttribute('aria-label', '幻灯片文本')

        const actions = window.document.createElement('div')
        const hint = window.document.createElement('span')
        hint.textContent = 'Ctrl/⌘ Enter 完成 · Esc 取消'
        const cancelButton = window.document.createElement('button')
        cancelButton.type = 'button'
        cancelButton.textContent = '取消'
        const applyButton = window.document.createElement('button')
        applyButton.type = 'button'
        applyButton.textContent = '完成'
        applyButton.className = 'primary'
        actions.append(hint, cancelButton, applyButton)
        overlay.append(label, input, actions)
        host.appendChild(overlay)

        const close = (): void => {
          if (closeTextEditor !== close) return
          closeTextEditor = undefined
          overlay.remove()
          const transformer = editorRect.scene.getTransformer()
          transformer?.clearControls()
          transformer?.activeAnObject(richText)
        }
        closeTextEditor = close

        const apply = async (): Promise<void> => {
          if (!active) {
            close()
            return
          }

          const text = input.value
          const snapshot = model.getSnapshot()
          const page = snapshot.body?.pages[editorRect.pageId]
          const element = page?.pageElements[richText.oKey]
          if (!element || !('richText' in element) || !element.richText) {
            setSetupError('无法定位当前文本对象，请重新打开演示文稿后再试')
            close()
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
            richText.show()
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
          if (!updated) setSetupError('文本修改失败，请重新打开演示文稿后再试')
          close()
        }

        cancelButton.addEventListener('click', close)
        applyButton.addEventListener('click', () => void apply())
        input.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void apply()
          }
        })
        input.focus({ preventScroll: true })
        input.setSelectionRange(input.value.length, input.value.length)
      }
      editSelectedTextRef.current = () => {
        const activePage = model.getActivePage()
        if (!activePage) {
          setSetupError('当前没有可编辑的幻灯片')
          return
        }

        const renderUnit = canvasView.getRenderUnitByPageId(activePage.id, model.getUnitId())
        const selectedObject = renderUnit.scene
          .getTransformer()
          ?.getSelectedObjectMap()
          .values()
          .next().value
        const previousEditorRect = lastTextEditorRect ?? editorBridge.getEditorRect()
        const editorRect = selectedObject?.objectType === ObjectType.RICH_TEXT
          ? {
              ...renderUnit,
              unitId: model.getUnitId(),
              pageId: activePage.id,
              richTextObj: selectedObject as RichText
            }
          : previousEditorRect?.pageId === activePage.id
            ? previousEditorRect
            : undefined
        if (!editorRect) {
          setSetupError('请先在幻灯片中选中一个文本框')
          return
        }

        setSetupError('')
        openTextEditor(editorRect)
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
        editSelectedTextRef.current = () => undefined
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
            onMouseDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              editSelectedTextRef.current()
            }}
            onClick={(event) => {
              if (event.detail === 0) editSelectedTextRef.current()
            }}
            disabled={document.conflict}
          >编辑所选文本</button>
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
