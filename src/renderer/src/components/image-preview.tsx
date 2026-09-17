import { useState } from 'react'
import type { ProjectImageFile } from '../../../shared/project'

export interface OpenImageDocument extends ProjectImageFile {
  name: string
  error: string
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

export function ImagePreview({
  document,
}: {
  document: OpenImageDocument
}): React.JSX.Element {
  const [dimensions, setDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [zoom, setZoom] = useState(100)
  const [fit, setFit] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  function setActualSize(): void {
    setZoom(100)
    setFit(false)
  }

  function adjustZoom(nextZoom: number): void {
    setZoom(Math.min(400, Math.max(25, nextZoom)))
    setFit(false)
  }

  return (
    <section
      className="image-preview-panel"
      aria-labelledby="active-image-title"
    >
      <h1 id="active-image-title" className="sr-only">
        {document.name}
      </h1>
      {document.error ? (
        <div className="document-error" role="alert">
          {document.error}
        </div>
      ) : null}
      <header className="image-preview-toolbar">
        <div className="image-preview-details">
          <span>
            {document.mimeType.replace('image/', '').toLocaleUpperCase()}
          </span>
          {dimensions ? (
            <span>
              {dimensions.width} × {dimensions.height}
            </span>
          ) : null}
          <span>{formatFileSize(document.size)}</span>
        </div>
        <div className="image-preview-zoom" aria-label="图片缩放">
          <button
            type="button"
            aria-label="缩小图片"
            disabled={!fit && zoom <= 25}
            onClick={() => adjustZoom(fit ? 75 : zoom - 25)}
          >
            −
          </button>
          <button
            className={!fit && zoom === 100 ? 'image-preview-zoom-active' : ''}
            type="button"
            onClick={setActualSize}
          >
            100%
          </button>
          <button
            type="button"
            aria-label="放大图片"
            disabled={!fit && zoom >= 400}
            onClick={() => adjustZoom(fit ? 125 : zoom + 25)}
          >
            +
          </button>
          <button
            className={fit ? 'image-preview-zoom-active' : ''}
            type="button"
            aria-pressed={fit}
            onClick={() => setFit(true)}
          >
            适应窗口
          </button>
        </div>
      </header>
      <div className="image-preview-canvas">
        {loadFailed ? (
          <div className="image-preview-error" role="alert">
            <strong>无法显示图片</strong>
            <span>文件内容可能已损坏，或与扩展名不匹配。</span>
          </div>
        ) : (
          <img
            className={fit ? 'image-preview-fit' : ''}
            src={document.dataUrl}
            alt={document.name}
            draggable={false}
            style={
              fit || !dimensions
                ? undefined
                : {
                    width: `${(dimensions.width * zoom) / 100}px`,
                    height: `${(dimensions.height * zoom) / 100}px`,
                  }
            }
            onLoad={(event) =>
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setLoadFailed(true)}
          />
        )}
      </div>
    </section>
  )
}
