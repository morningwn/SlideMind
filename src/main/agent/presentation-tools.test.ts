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
})
