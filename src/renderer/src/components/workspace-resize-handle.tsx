import { useState } from 'react'

interface WorkspaceResizeHandleProps {
  orientation: 'vertical' | 'horizontal'
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

export function WorkspaceResizeHandle({
  orientation,
  label,
  value,
  min,
  max,
  onChange,
}: WorkspaceResizeHandleProps): React.JSX.Element {
  const [dragOrigin, setDragOrigin] = useState<{
    coordinate: number
    value: number
  } | null>(null)
  const vertical = orientation === 'vertical'
  const update = (next: number): void =>
    onChange(Math.min(max, Math.max(min, next)))

  return (
    <div
      className={`workspace-resize-handle workspace-resize-${orientation}${dragOrigin ? ' is-dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragOrigin({
          coordinate: vertical ? event.clientX : event.clientY,
          value,
        })
      }}
      onPointerMove={(event) => {
        if (dragOrigin)
          update(
            dragOrigin.value +
              (vertical ? event.clientX : event.clientY) -
              dragOrigin.coordinate,
          )
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        setDragOrigin(null)
      }}
      onLostPointerCapture={() => setDragOrigin(null)}
      onKeyDown={(event) => {
        const decrease = vertical ? 'ArrowLeft' : 'ArrowUp'
        const increase = vertical ? 'ArrowRight' : 'ArrowDown'
        if (![decrease, increase, 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        update(
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : value + (event.key === decrease ? -10 : 10),
        )
      }}
    >
      {dragOrigin ? <span className="workspace-resize-overlay" /> : null}
    </div>
  )
}
