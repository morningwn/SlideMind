import { describe, expect, it } from 'vitest'
import type { PresentationDocument } from '../../../shared/presentation'
import { serializePresentationDocumentState } from './presentation-document-state'

function presentationWithOrder(order: 'stored' | 'editor'): PresentationDocument {
  const theme = {
    backgroundColor: '#ffffff',
    themeColors: ['#5b9bd5'],
    fontColor: '#333333',
    fontName: '',
    outline: { width: 2, color: '#525252', style: 'solid' },
    shadow: { h: 3, v: 3, blur: 2, color: '#808080' }
  }
  const slides = [{ id: 'slide-1', elements: [] }]
  const presentation = order === 'stored'
    ? { title: '季度复盘', viewportSize: 1000, viewportRatio: 0.5625, theme, slides }
    : { title: '季度复盘', theme, slides, viewportSize: 1000, viewportRatio: 0.5625 }

  return {
    format: 'slidemind.presentation',
    version: 2,
    presentation
  }
}

function addTextElement(document: PresentationDocument, overrides: Record<string, unknown> = {}): void {
  document.presentation.slides[0].elements.push({
    id: 'text-1',
    type: 'text',
    left: 100,
    top: 100,
    width: 400,
    height: 80,
    rotate: 0,
    content: '<p>正文</p>',
    ...overrides
  })
}

describe('serializePresentationDocumentState', () => {
  it('treats editor output with reordered object keys as unchanged', () => {
    const stored = presentationWithOrder('stored')
    const editor = presentationWithOrder('editor')

    expect(JSON.stringify(editor)).not.toBe(JSON.stringify(stored))
    expect(serializePresentationDocumentState(editor)).toBe(
      serializePresentationDocumentState(stored)
    )
  })

  it('detects a real presentation edit', () => {
    const stored = presentationWithOrder('stored')
    const edited = presentationWithOrder('editor')
    edited.presentation.title = '年度复盘'

    expect(serializePresentationDocumentState(edited)).not.toBe(
      serializePresentationDocumentState(stored)
    )
  })

  it('ignores the derived height of an auto-sized horizontal text element', () => {
    const stored = presentationWithOrder('stored')
    const measured = presentationWithOrder('editor')
    addTextElement(stored)
    addTextElement(measured, { height: 81.5 })

    expect(serializePresentationDocumentState(measured)).toBe(
      serializePresentationDocumentState(stored)
    )
  })

  it('still detects user-controlled text dimensions', () => {
    const stored = presentationWithOrder('stored')
    const resized = presentationWithOrder('editor')
    addTextElement(stored)
    addTextElement(resized, { width: 420 })

    expect(serializePresentationDocumentState(resized)).not.toBe(
      serializePresentationDocumentState(stored)
    )
  })

  it('ignores only the derived axis for vertical and fixed-height text', () => {
    const verticalStored = presentationWithOrder('stored')
    const verticalMeasured = presentationWithOrder('editor')
    addTextElement(verticalStored, { vertical: true })
    addTextElement(verticalMeasured, { vertical: true, width: 401.5 })

    expect(serializePresentationDocumentState(verticalMeasured)).toBe(
      serializePresentationDocumentState(verticalStored)
    )

    const fixedStored = presentationWithOrder('stored')
    const fixedResized = presentationWithOrder('editor')
    addTextElement(fixedStored, { fixedHeight: true })
    addTextElement(fixedResized, { fixedHeight: true, height: 81.5 })

    expect(serializePresentationDocumentState(fixedResized)).not.toBe(
      serializePresentationDocumentState(fixedStored)
    )
  })

  it('ignores a table height remeasured from its row content', () => {
    const stored = presentationWithOrder('stored')
    const measured = presentationWithOrder('editor')
    const table = {
      id: 'table-1',
      type: 'table',
      left: 100,
      top: 100,
      width: 600,
      height: 180,
      rotate: 0,
      cellMinHeight: 36,
      data: []
    }
    stored.presentation.slides[0].elements.push(table)
    measured.presentation.slides[0].elements.push({ ...table, height: 181.25 })

    expect(serializePresentationDocumentState(measured)).toBe(
      serializePresentationDocumentState(stored)
    )
  })
})
