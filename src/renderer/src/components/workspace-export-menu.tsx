import { useEffect, useRef, useState } from 'react'

interface WorkspaceExportOption<Format extends string> {
  format: Format
  label: string
  description: string
}

interface WorkspaceExportMenuProps<Format extends string> {
  options: readonly WorkspaceExportOption<Format>[]
  exportingFormat?: Format
  disabled: boolean
  onExport: (format: Format) => void
}

export function WorkspaceExportMenu<Format extends string>({
  options,
  exportingFormat,
  disabled,
  onExport,
}: WorkspaceExportMenuProps<Format>): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    controlRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus()

    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!controlRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  return (
    <div className="workspace-export-control" ref={controlRef}>
      <button
        className="workspace-export-button"
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setIsOpen(true)
          }
        }}
      >
        {exportingFormat ? '导出中…' : '导出'}
        <span className="workspace-export-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {isOpen ? (
        <div
          className="workspace-export-menu"
          role="menu"
          aria-label="导出格式"
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              setIsOpen(false)
              return
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
              return
            event.preventDefault()
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]',
              ),
            ]
            const index = items.indexOf(event.target as HTMLButtonElement)
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (index +
                      (event.key === 'ArrowUp' ? -1 : 1) +
                      items.length) %
                    items.length
            items[next].focus()
          }}
        >
          {options.map((option) => (
            <button
              key={option.format}
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                triggerRef.current?.focus()
                onExport(option.format)
              }}
            >
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
