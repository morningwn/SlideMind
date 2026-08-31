import type { IDocumentBody } from '@univerjs/core'
import { describe, expect, it, vi } from 'vitest'
import { finishPresentationTextSession } from './presentation-text-session'

describe('finishPresentationTextSession', () => {
  it('updates the shared document body before ending the edit session once', () => {
    const body: IDocumentBody = {
      dataStream: 'old\r\n',
      textRuns: [{ st: 0, ed: 3, ts: { bl: 1 } }],
      paragraphs: [{ startIndex: 4 }]
    }
    const clearControls = vi.fn()

    finishPresentationTextSession(
      { text: 'old', documentData: { body } },
      { clearControls },
      'new title',
      true
    )

    expect(body).toMatchObject({
      dataStream: 'new title\r\n',
      textRuns: [{ st: 0, ed: 9, ts: { bl: 1 } }]
    })
    expect(body.paragraphs).toBeUndefined()
    expect(clearControls).toHaveBeenCalledOnce()
  })

  it('ends a cancelled edit session without changing its document body', () => {
    const body: IDocumentBody = {
      dataStream: 'old\r\n',
      textRuns: [{ st: 0, ed: 3 }]
    }
    const originalBody = structuredClone(body)
    const clearControls = vi.fn()

    finishPresentationTextSession(
      { text: 'old', documentData: { body } },
      { clearControls },
      'discarded',
      false
    )

    expect(body).toEqual(originalBody)
    expect(clearControls).toHaveBeenCalledOnce()
  })
})
