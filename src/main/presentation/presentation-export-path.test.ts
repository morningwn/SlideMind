import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defaultPresentationSavePath,
  ensurePptxOutputPath
} from './presentation-export-path'

describe('presentation export paths', () => {
  it('defaults exports to the desktop with a PowerPoint file name', () => {
    expect(defaultPresentationSavePath('/Users/test/Desktop', 'decks/季度复盘.slides.json')).toBe(
      join('/Users/test/Desktop', '季度复盘.pptx')
    )
  })

  it('adds the PowerPoint extension when the save dialog omits it', () => {
    expect(ensurePptxOutputPath('/Users/test/Desktop/季度复盘')).toBe(
      '/Users/test/Desktop/季度复盘.pptx'
    )
    expect(ensurePptxOutputPath('/Users/test/Desktop/季度复盘.PPTX')).toBe(
      '/Users/test/Desktop/季度复盘.PPTX'
    )
  })
})
