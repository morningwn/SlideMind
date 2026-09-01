import { describe, expect, it } from 'vitest'
import type { PptistElement, PresentationDocument } from '../../shared/presentation'
import { createBlankPresentationDocument } from '../presentation/presentation-store'
import { reviewPresentationDocument } from './deck-review'

function documentWith(elements: PptistElement[]): PresentationDocument {
  const document = createBlankPresentationDocument('质量审查')
  document.presentation.slides[0] = {
    id: 'slide-1',
    elements
  }
  return document
}

describe('reviewPresentationDocument', () => {
  it('reports blocking placeholders and rotated content outside the canvas', () => {
    const result = reviewPresentationDocument(documentWith([
      {
        id: 'title',
        type: 'text',
        left: 970,
        top: 200,
        width: 100,
        height: 20,
        rotate: 90,
        content: '<p><span style="font-size: 9px">TBD</span></p>',
        textType: 'title'
      }
    ]))

    expect(result.status).toBe('fail')
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'placeholder-text', severity: 'blocker' }),
      expect.objectContaining({ code: 'element-out-of-bounds', severity: 'blocker' }),
      expect.objectContaining({ code: 'small-text', severity: 'blocker' })
    ]))
  })

  it('uses the rotated bounding box instead of the unrotated rectangle', () => {
    const result = reviewPresentationDocument(documentWith([
      {
        id: 'rotated-label',
        type: 'text',
        left: 940,
        top: 200,
        width: 100,
        height: 20,
        rotate: 90,
        content: '<p><span style="font-size: 16px">标签</span></p>'
      }
    ]))

    expect(result.issues.some((issue) => issue.code === 'element-out-of-bounds')).toBe(false)
  })

  it('flags overlapping text and content covered by a later shape', () => {
    const result = reviewPresentationDocument(documentWith([
      {
        id: 'left-copy',
        type: 'text',
        left: 100,
        top: 100,
        width: 300,
        height: 100,
        rotate: 0,
        content: '<p><span style="font-size: 20px">核心结论</span></p>'
      },
      {
        id: 'right-copy',
        type: 'text',
        left: 250,
        top: 120,
        width: 300,
        height: 100,
        rotate: 0,
        content: '<p><span style="font-size: 20px">支撑证据</span></p>'
      },
      {
        id: 'cover',
        type: 'shape',
        left: 100,
        top: 100,
        width: 300,
        height: 100,
        rotate: 0,
        fill: '#ffffff'
      }
    ]))

    expect(result.status).toBe('needs-attention')
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'content-overlap' }),
      expect.objectContaining({ code: 'content-may-be-covered' })
    ]))
  })

  it('reports an empty deck page and preserves the manual validation boundary', () => {
    const result = reviewPresentationDocument(createBlankPresentationDocument('空白稿'))

    expect(result).toMatchObject({
      status: 'fail',
      summary: { blocker: 1 },
      unsupportedForAutomaticRewrite: []
    })
    expect(result.manualChecks).toContain('文本最终换行、裁切和图片裁切')
  })

  it('retains blockers when the returned issue list is truncated', () => {
    const images: PptistElement[] = Array.from({ length: 251 }, (_, index) => ({
      id: `image-${index}`,
      type: 'image',
      left: index,
      top: 10,
      width: 10,
      height: 10,
      rotate: 0,
      src: `data:image/png;base64,${index}`
    }))
    const result = reviewPresentationDocument(documentWith([
      ...images,
      {
        id: 'placeholder',
        type: 'text',
        left: 100,
        top: 100,
        width: 300,
        height: 50,
        rotate: 0,
        content: '<p><span style="font-size: 20px">TODO</span></p>'
      }
    ]))

    expect(result).toMatchObject({
      issueCount: 252,
      issuesTruncated: true,
      status: 'fail',
      summary: { blocker: 1, info: 251, warning: 0 }
    })
    expect(result.issues).toHaveLength(250)
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'placeholder-text',
      severity: 'blocker'
    }))
  })
})
