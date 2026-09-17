import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import {
  serializePptistPresentation,
  type PresentationState,
} from './pptist-snapshot'

function fixture(): PresentationState {
  return reactive({
    title: 'Deck',
    theme: { fontColor: '#123456' },
    viewportSize: 1000,
    viewportRatio: 0.5625,
    slides: [
      { id: 'slide', elements: [{ id: 'text', content: '<p>Hello</p>' }] },
    ],
  })
}

describe('serializePptistPresentation', () => {
  it('preserves the JSON snapshot after nested edits and inserted reactive objects', () => {
    const presentation = fixture()
    presentation.theme.fontColor = '#ffffff'
    presentation.slides.push(
      reactive({ id: 'new', elements: [{ content: 'updated' }] }),
    )
    expect(JSON.parse(serializePptistPresentation(presentation))).toEqual(
      JSON.parse(JSON.stringify(presentation)),
    )
  })

  it('captures an independent snapshot and reflects subsequent edits on the next call', () => {
    const presentation = fixture()
    const snapshot = serializePptistPresentation(presentation)
    presentation.slides[0].id = 'changed'
    expect(JSON.parse(snapshot).slides[0].id).toBe('slide')
    expect(
      JSON.parse(serializePptistPresentation(presentation)).slides[0].id,
    ).toBe('changed')
  })

  it('retains JSON semantics for omitted fields and array placeholders', () => {
    const presentation = fixture()
    presentation.slides[0].optional = undefined
    presentation.slides[0].values = [
      undefined,
      null,
      'data:image/png;base64,example',
    ]
    expect(JSON.parse(serializePptistPresentation(presentation))).toEqual(
      JSON.parse(JSON.stringify(presentation)),
    )
  })
})
