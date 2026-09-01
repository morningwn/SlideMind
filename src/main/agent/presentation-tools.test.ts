import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PresentationDocument } from '../../shared/presentation'
import { createBlankPresentationDocument } from '../presentation/presentation-store'
import type { PresentationService } from '../presentation/presentation-service'
import { createPresentationToolsExtension } from './presentation-tools'

interface RegisteredTool {
  name: string
  execute(
    toolCallId: string,
    params: Record<string, unknown>
  ): Promise<{ details: unknown }>
}

describe('createPresentationToolsExtension', () => {
  it('embeds a safe project-relative image path before saving slides', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-slide-image-'))
    await mkdir(join(projectPath, 'assets'))
    await writeFile(join(projectPath, 'assets', 'cover.png'), Buffer.from([1, 2, 3]))
    const revision = 'a'.repeat(64)
    let document = createBlankPresentationDocument('封面')
    const presentationService = {
      async read() {
        return { path: 'deck.slides.json', revision, document: structuredClone(document) }
      },
      async save(
        _projectPath: string,
        _projectHandle: string,
        input: unknown
      ) {
        document = structuredClone((input as { document: PresentationDocument }).document)
        return { ok: true as const, revision: 'b'.repeat(64) }
      }
    } as unknown as PresentationService
    const registeredTools = new Map<string, RegisteredTool>()
    const extension = createPresentationToolsExtension({
      presentationService,
      projectHandle: 'project-handle',
      projectPath
    })

    await extension({
      registerTool: (tool: RegisteredTool) => registeredTools.set(tool.name, tool)
    } as unknown as ExtensionAPI)

    await registeredTools.get('slides_write')!.execute('write-call', {
      file: 'deck.slides.json',
      revision,
      title: '封面',
      slides: [{
        title: '封面',
        elements: [{
          type: 'image',
          x: 0,
          y: 0,
          width: 1000,
          height: 562.5,
          source: 'assets/cover.png',
          alt: '封面图'
        }]
      }]
    })

    expect(document.presentation.slides[0].elements[0]).toMatchObject({
      type: 'image',
      src: 'data:image/png;base64,AQID',
      name: '封面图'
    })
  })

  it('rejects image paths outside the project', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-slide-image-project-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-slide-image-outside-'))
    await writeFile(join(outsidePath, 'outside.png'), Buffer.from([1, 2, 3]))
    const revision = 'a'.repeat(64)
    const document = createBlankPresentationDocument('封面')
    const presentationService = {
      async read() {
        return { path: 'deck.slides.json', revision, document: structuredClone(document) }
      }
    } as unknown as PresentationService
    const registeredTools = new Map<string, RegisteredTool>()
    const extension = createPresentationToolsExtension({
      presentationService,
      projectHandle: 'project-handle',
      projectPath
    })

    await extension({
      registerTool: (tool: RegisteredTool) => registeredTools.set(tool.name, tool)
    } as unknown as ExtensionAPI)

    await expect(registeredTools.get('slides_write')!.execute('write-call', {
      file: 'deck.slides.json',
      revision,
      title: '封面',
      slides: [{
        title: '封面',
        elements: [{
          type: 'image',
          x: 0,
          y: 0,
          width: 1000,
          height: 562.5,
          source: relative(projectPath, join(outsidePath, 'outside.png'))
        }]
      }]
    })).rejects.toThrow('文件路径超出项目范围')
  })

  it('writes editable orthogonal arrow lines and reports their absolute endpoints', async () => {
    const revision = 'a'.repeat(64)
    let document = createBlankPresentationDocument('流程图')
    const presentationService = {
      async read() {
        return { path: 'flow.slides.json', revision, document: structuredClone(document) }
      },
      async save(
        _projectPath: string,
        _projectHandle: string,
        input: unknown
      ) {
        document = structuredClone((input as { document: PresentationDocument }).document)
        return { ok: true as const, revision: 'b'.repeat(64) }
      }
    } as unknown as PresentationService
    const registeredTools = new Map<string, RegisteredTool>()
    const extension = createPresentationToolsExtension({
      presentationService,
      projectHandle: 'project-handle',
      projectPath: '/project'
    })

    await extension({
      registerTool: (tool: RegisteredTool) => registeredTools.set(tool.name, tool)
    } as unknown as ExtensionAPI)

    await registeredTools.get('slides_write')!.execute('write-call', {
      file: 'flow.slides.json',
      revision,
      title: '流程图',
      slides: [{
        title: '流程',
        elements: [{
          type: 'line',
          x1: 250,
          y1: 284,
          x2: 720,
          y2: 390,
          routing: 'orthogonal',
          style: 'dashed',
          lineWidth: 3,
          startMarker: 'dot',
          endMarker: 'arrow'
        }]
      }]
    })

    expect(document.presentation.slides[0].elements[0]).toMatchObject({
      type: 'line',
      left: 250,
      top: 284,
      start: [0, 0],
      end: [470, 106],
      broken2: [235, 53],
      broken2Direction: 'horizontal',
      points: ['dot', 'arrow'],
      style: 'dashed',
      width: 3
    })

    const readResult = await registeredTools.get('slides_read')!.execute('read-call', {
      file: 'flow.slides.json'
    })
    expect(readResult.details).toMatchObject({
      slides: [{
        elements: [{
          type: 'line',
          x1: 250,
          y1: 284,
          x2: 720,
          y2: 390,
          lineWidth: 3,
          routing: 'orthogonal'
        }]
      }]
    })
  })

  it('reports imported notes, table cells, chart data and paginates large decks', async () => {
    const revision = 'a'.repeat(64)
    const document = createBlankPresentationDocument('导入材料')
    document.presentation.slides = Array.from({ length: 51 }, (_, index) => ({
      id: `slide-${index + 1}`,
      name: `页面 ${index + 1}`,
      remark: index === 50 ? '<p>最后一页备注</p>' : '',
      elements: index === 50 ? [
        {
          id: 'table-1',
          type: 'table',
          left: 20,
          top: 20,
          width: 400,
          height: 200,
          rotate: 0,
          data: [[{ text: '<p>季度</p>' }, { text: '<p>收入</p>' }]]
        },
        {
          id: 'chart-1',
          type: 'chart',
          left: 450,
          top: 20,
          width: 400,
          height: 240,
          rotate: 0,
          chartType: 'bar',
          data: { labels: ['Q1'], legends: ['收入'], series: [[120]] }
        }
      ] : []
    }))
    const presentationService = {
      async read() {
        return { path: 'imported.slides.json', revision, document: structuredClone(document) }
      }
    } as unknown as PresentationService
    const registeredTools = new Map<string, RegisteredTool>()
    const extension = createPresentationToolsExtension({
      presentationService,
      projectHandle: 'project-handle',
      projectPath: '/project'
    })
    await extension({
      registerTool: (tool: RegisteredTool) => registeredTools.set(tool.name, tool)
    } as unknown as ExtensionAPI)

    const firstRead = await registeredTools.get('slides_read')!.execute('read-call', {
      file: 'imported.slides.json'
    })
    expect(firstRead.details).toMatchObject({
      totalSlideCount: 51,
      startSlide: 1,
      endSlide: 50,
      truncated: true
    })

    const lastRead = await registeredTools.get('slides_read')!.execute('read-call', {
      file: 'imported.slides.json',
      startSlide: 51,
      endSlide: 51
    })
    expect(lastRead.details).toMatchObject({
      startSlide: 51,
      endSlide: 51,
      slides: [{
        number: 51,
        notes: '最后一页备注',
        elements: [
          { type: 'table', table: [['季度', '收入']] },
          {
            type: 'chart',
            chart: {
              chartType: 'bar',
              data: { labels: ['Q1'], legends: ['收入'], series: [[120]] }
            }
          }
        ]
      }]
    })

    await expect(registeredTools.get('slides_read')!.execute('read-call', {
      file: 'imported.slides.json',
      startSlide: 52
    })).rejects.toThrow('起始页超出演示文稿页数（共 51 页）')
  })
})
