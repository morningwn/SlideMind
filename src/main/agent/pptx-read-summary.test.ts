import PptxGenJS from 'pptxgenjs'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { summarizePptxBytes } from './pptx-read-summary'

describe('summarizePptxBytes', () => {
  it('extracts slide text and speaker notes from a raw PPTX', async () => {
    const path = join(tmpdir(), `slidemind-pptx-summary-${randomUUID()}.pptx`)
    const pptx = new PptxGenJS()
    const slide = pptx.addSlide()
    slide.addText('产品路线图', { x: 1, y: 1, w: 5, h: 1 })
    slide.addNotes('演讲者备注')
    await pptx.writeFile({ fileName: path, compression: true })
    const data = await readFile(path)
    const bytes = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    )

    const summary = await summarizePptxBytes(bytes)

    expect(summary).toMatchObject({
      totalSlideCount: 1,
      startSlide: 1,
      endSlide: 1,
      slides: [
        {
          number: 1,
          notes: '演讲者备注',
          texts: ['产品路线图'],
        },
      ],
    })
  })
})
