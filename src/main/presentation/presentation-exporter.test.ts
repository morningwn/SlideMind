import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBlankPresentationDocument } from './presentation-store'
import {
  exportPresentationToPptx,
  pptistHtmlToPlainText
} from './presentation-exporter'

describe('exportPresentationToPptx', () => {
  it('writes an OOXML PowerPoint from PPTist text and shapes', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'slidemind-pptx-'))
    const outputPath = join(outputDirectory, 'deck.pptx')
    const document = createBlankPresentationDocument('导出演示文稿')
    document.presentation.slides[0].elements = [
      {
        id: 'title',
        type: 'text',
        left: 80,
        top: 72,
        width: 800,
        height: 80,
        rotate: 0,
        content: '<p><strong>SlideMind</strong><br>导出测试</p>',
        defaultFontName: 'Arial',
        defaultColor: '#24488E'
      },
      {
        id: 'accent',
        type: 'shape',
        left: 80,
        top: 180,
        width: 260,
        height: 120,
        rotate: 0,
        viewBox: [200, 200],
        path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
        fixedRatio: false,
        fill: '#DCE7FF',
        text: {
          content: '<p>可编辑形状</p>',
          defaultFontName: '',
          defaultColor: '#333333',
          align: 'middle'
        }
      }
    ]

    await exportPresentationToPptx(document.presentation, outputPath)
    const bytes = await readFile(outputPath)
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(bytes.byteLength).toBeGreaterThan(5_000)
  })

  it('converts PPTist HTML into readable text', () => {
    expect(pptistHtmlToPlainText('<p>A &amp; B<br>C</p>')).toBe('A & B\nC')
  })
})
