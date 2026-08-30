import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BasicShapes } from '@univerjs/slides'
import { describe, expect, it } from 'vitest'
import { createBlankPresentationDocument } from './presentation-store'
import { exportPresentationToPptx } from './presentation-exporter'

describe('exportPresentationToPptx', () => {
  it('writes an OOXML PowerPoint with basic text and shapes', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'slidemind-pptx-'))
    const outputPath = join(outputDirectory, 'deck.pptx')
    const document = createBlankPresentationDocument('导出演示文稿')
    const pageId = document.snapshot.body?.pageOrder[0]
    if (!pageId || !document.snapshot.body) throw new Error('测试演示文稿缺少页面')
    document.snapshot.body.pages[pageId].pageElements = {
      title: {
        id: 'title',
        zIndex: 1,
        left: 80,
        top: 72,
        width: 800,
        height: 80,
        title: '标题',
        description: '',
        type: 2,
        richText: {
          text: 'SlideMind 导出测试',
          fs: 30,
          bl: 1,
          cl: { rgb: '#24488E' }
        }
      },
      accent: {
        id: 'accent',
        zIndex: 2,
        left: 80,
        top: 180,
        width: 260,
        height: 120,
        title: '强调块',
        description: '',
        type: 0,
        shape: {
          shapeType: BasicShapes.RoundRect,
          text: '可编辑形状',
          shapeProperties: {
            shapeBackgroundFill: { rgb: '#DCE7FF' }
          }
        }
      }
    }

    await exportPresentationToPptx(document.snapshot, outputPath)
    const bytes = await readFile(outputPath)
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(bytes.byteLength).toBeGreaterThan(5_000)
  })
})
