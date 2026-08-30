import { LocaleType, mergeLocales, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import DesignZhCN from '@univerjs/design/locale/zh-CN'
import { UniverDocsPlugin } from '@univerjs/docs'
import { UniverDocsUIPlugin } from '@univerjs/docs-ui'
import DocsUIZhCN from '@univerjs/docs-ui/locale/zh-CN'
import { UniverDrawingPlugin } from '@univerjs/drawing'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { SlideDataModel, UniverSlidesPlugin, type ISlideData } from '@univerjs/slides'
import { UniverSlidesUIPlugin } from '@univerjs/slides-ui'
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
    let active = true
    let ready = false

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
        toolbar: true,
        disableAutoFocus: true
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
      const commandSubscription = univerApi.onCommandExecuted(() => {
        if (!ready || !active) return
        if (changeTimer !== undefined) window.clearTimeout(changeTimer)
        changeTimer = window.setTimeout(() => {
          if (!active) return
          onChangeRef.current({
            ...document.document,
            snapshot: structuredClone(model.getSnapshot())
          })
        }, 120)
      })
      queueMicrotask(() => {
        ready = true
      })

      return () => {
        active = false
        if (changeTimer !== undefined) window.clearTimeout(changeTimer)
        commandSubscription.dispose()
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
