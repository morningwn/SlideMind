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
})
