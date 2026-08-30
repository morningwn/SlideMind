import { randomUUID } from 'node:crypto'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { IPageElement, ISlideData } from '@univerjs/slides'
import {
  PRESENTATION_FORMAT,
  PRESENTATION_FORMAT_VERSION,
  type PresentationDocument
} from '../../shared/presentation'
import type { PresentationService } from '../presentation/presentation-service'

type SlideInput = {
  title: string
  background?: string
  elements: Array<
    | {
      type: 'text'
      x: number
      y: number
      width: number
      height: number
      rotation?: number
      text: string
      fontSize?: number
      fontFamily?: string
      color?: string
      bold?: boolean
      italic?: boolean
    }
    | {
      type: 'shape'
      x: number
      y: number
      width: number
      height: number
      rotation?: number
      shape?: string
      text?: string
      fill?: string
      lineColor?: string
      lineWidth?: number
      fontSize?: number
      color?: string
    }
    | {
      type: 'image'
      x: number
      y: number
      width: number
      height: number
      rotation?: number
      source: string
      alt?: string
    }
  >
}

function color(value: string | undefined, fallback: string): { rgb: string } {
  return { rgb: value?.trim() || fallback }
}

function createElement(
  element: SlideInput['elements'][number],
  zIndex: number
): IPageElement {
  const id = randomUUID()
  const base = {
    id,
    zIndex,
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    angle: element.rotation ?? 0,
    title: element.type,
    description: ''
  }
  if (element.type === 'text') {
    return {
      ...base,
      type: 2,
      richText: {
        text: element.text,
        fs: element.fontSize ?? 24,
        ff: element.fontFamily,
        cl: color(element.color, '#333333'),
        bl: element.bold ? 1 : 0,
        it: element.italic ? 1 : 0
      }
    }
  }
  if (element.type === 'shape') {
    return {
      ...base,
      type: 0,
      shape: {
        shapeType: (element.shape ?? 'rect') as NonNullable<IPageElement['shape']>['shapeType'],
        text: element.text ?? '',
        shapeProperties: {
          shapeBackgroundFill: color(element.fill, '#DCE7FF'),
          outline: {
            outlineFill: color(element.lineColor, '#8EA4CC'),
            weight: element.lineWidth ?? 1
          }
        }
      },
      richText: element.text
        ? {
            text: element.text,
            fs: element.fontSize ?? 18,
            cl: color(element.color, '#333333')
          }
        : undefined
    }
  }
  if (!element.source.startsWith('data:image/')) {
    throw new Error('图片 source 当前仅支持 data:image/... URL')
  }
  return {
    ...base,
    type: 1,
    description: element.alt ?? '',
    image: {
      imageProperties: { contentUrl: element.source }
    }
  }
}

function slidesToDocument(
  current: PresentationDocument,
  title: string,
  slides: SlideInput[]
): PresentationDocument {
  const pages: NonNullable<ISlideData['body']>['pages'] = {}
  const pageOrder: string[] = []
  slides.forEach((slide, pageIndex) => {
    const pageId = randomUUID()
    pageOrder.push(pageId)
    const pageElements = Object.fromEntries(slide.elements.map((element, elementIndex) => {
      const created = createElement(element, elementIndex + 1)
      return [created.id, created]
    }))
    pages[pageId] = {
      id: pageId,
      pageType: 0,
      zIndex: pageIndex + 1,
      title: slide.title,
      description: '',
      pageBackgroundFill: color(slide.background, '#FFFFFF'),
      pageElements
    }
  })
  return {
    format: PRESENTATION_FORMAT,
    version: PRESENTATION_FORMAT_VERSION,
    snapshot: {
      ...current.snapshot,
      title,
      body: { pages, pageOrder }
    }
  }
}

function snapshotSummary(snapshot: ISlideData): Record<string, unknown> {
  const body = snapshot.body
  return {
    id: snapshot.id,
    title: snapshot.title,
    pageSize: snapshot.pageSize,
    slides: body?.pageOrder.map((pageId) => {
      const page = body.pages[pageId]
      return {
        id: pageId,
        title: page?.title ?? '',
        background: page?.pageBackgroundFill.rgb ?? '#FFFFFF',
        elements: Object.values(page?.pageElements ?? {}).map((element) => ({
          id: element.id,
          type: element.type === 0 ? 'shape' : element.type === 1 ? 'image' : 'text',
          x: element.left ?? 0,
          y: element.top ?? 0,
          width: element.width ?? 0,
          height: element.height ?? 0,
          rotation: element.angle ?? 0,
          text: element.richText?.text ?? element.shape?.text ?? '',
          shape: element.shape?.shapeType,
          fill: element.shape?.shapeProperties.shapeBackgroundFill.rgb,
          fontSize: element.richText?.fs,
          color: element.richText?.cl?.rgb,
          image: element.image ? '[embedded image]' : undefined
        }))
      }
    }) ?? []
  }
}

function toolText(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    details: value
  }
}

export function createPresentationToolsExtension(options: {
  presentationService: PresentationService
  projectHandle: string
  projectPath: string
}): ExtensionFactory {
  return async (pi) => {
    const { Type } = await import('@earendil-works/pi-ai')
    const elementBase = {
      x: Type.Number({ minimum: 0, maximum: 100_000 }),
      y: Type.Number({ minimum: 0, maximum: 100_000 }),
      width: Type.Number({ exclusiveMinimum: 0, maximum: 100_000 }),
      height: Type.Number({ exclusiveMinimum: 0, maximum: 100_000 }),
      rotation: Type.Optional(Type.Number({ minimum: -360, maximum: 360 }))
    }
    const textElementSchema = Type.Object({
      type: Type.Literal('text'),
      ...elementBase,
      text: Type.String({ maxLength: 50_000 }),
      fontSize: Type.Optional(Type.Number({ minimum: 1, maximum: 400 })),
      fontFamily: Type.Optional(Type.String({ maxLength: 200 })),
      color: Type.Optional(Type.String({ maxLength: 100 })),
      bold: Type.Optional(Type.Boolean()),
      italic: Type.Optional(Type.Boolean())
    }, { additionalProperties: false })
    const shapeElementSchema = Type.Object({
      type: Type.Literal('shape'),
      ...elementBase,
      shape: Type.Optional(Type.String({ maxLength: 100 })),
      text: Type.Optional(Type.String({ maxLength: 50_000 })),
      fill: Type.Optional(Type.String({ maxLength: 100 })),
      lineColor: Type.Optional(Type.String({ maxLength: 100 })),
      lineWidth: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
      fontSize: Type.Optional(Type.Number({ minimum: 1, maximum: 400 })),
      color: Type.Optional(Type.String({ maxLength: 100 }))
    }, { additionalProperties: false })
    const imageElementSchema = Type.Object({
      type: Type.Literal('image'),
      ...elementBase,
      source: Type.String({ maxLength: 40_000_000 }),
      alt: Type.Optional(Type.String({ maxLength: 2_000 }))
    }, { additionalProperties: false })
    const slideSchema = Type.Object({
      title: Type.String({ minLength: 1, maxLength: 10_000 }),
      background: Type.Optional(Type.String({ maxLength: 100 })),
      elements: Type.Array(
        Type.Union([textElementSchema, shapeElementSchema, imageElementSchema]),
        { maxItems: 5_000 }
      )
    }, { additionalProperties: false })

    pi.registerTool({
      name: 'slides_create',
      label: '新建演示文稿',
      description: '在当前项目中新建一个 SlideMind/Univer 演示文稿。文件名必须以 .slides.json 结尾。',
      promptSnippet: 'Create an editable SlideMind presentation.',
      parameters: Type.Object({
        file: Type.String({ minLength: 1, maxLength: 4096 }),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 }))
      }, { additionalProperties: false }),
      async execute(_toolCallId, params) {
        const created = await options.presentationService.create(
          options.projectPath,
          options.projectHandle,
          { path: params.file, title: params.title }
        )
        return toolText({
          file: created.path,
          revision: created.revision,
          ...snapshotSummary(created.document.snapshot)
        })
      }
    })

    pi.registerTool({
      name: 'slides_read',
      label: '读取演示文稿',
      description: '读取演示文稿结构和当前修订号。写入前必须先读取并使用返回的 revision。',
      promptSnippet: 'Inspect an editable SlideMind presentation.',
      parameters: Type.Object({
        file: Type.String({ minLength: 1, maxLength: 4096 })
      }, { additionalProperties: false }),
      async execute(_toolCallId, params) {
        const file = await options.presentationService.read(options.projectPath, params.file)
        return toolText({
          file: file.path,
          revision: file.revision,
          ...snapshotSummary(file.document.snapshot)
        })
      }
    })

    pi.registerTool({
      name: 'slides_write',
      label: '写入演示文稿',
      description: '使用结构化页面替换演示文稿内容。revision 必须来自最近一次 slides_read。',
      promptSnippet: 'Write structured slides with text, shapes, and embedded images.',
      promptGuidelines: [
        'Use a 960×540 coordinate system unless slides_read reports another page size.',
        'Call slides_read immediately before slides_write and pass its revision.'
      ],
      parameters: Type.Object({
        file: Type.String({ minLength: 1, maxLength: 4096 }),
        revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        title: Type.String({ minLength: 1, maxLength: 200 }),
        slides: Type.Array(slideSchema, { minItems: 1, maxItems: 500 })
      }, { additionalProperties: false }),
      async execute(_toolCallId, params) {
        const current = await options.presentationService.read(options.projectPath, params.file)
        const document = slidesToDocument(
          current.document,
          params.title,
          params.slides as SlideInput[]
        )
        const result = await options.presentationService.save(
          options.projectPath,
          options.projectHandle,
          { path: params.file, revision: params.revision, document }
        )
        if (!result.ok) {
          throw new Error(`演示文稿已被修改，请重新调用 slides_read；当前修订号：${result.currentRevision}`)
        }
        return toolText({
          file: params.file,
          revision: result.revision,
          slideCount: params.slides.length,
          title: params.title
        })
      }
    })

    pi.registerTool({
      name: 'slides_export',
      label: '导出 PowerPoint',
      description: '把当前项目中的 .slides.json 演示文稿导出为可编辑的 .pptx 文件。',
      promptSnippet: 'Export a SlideMind presentation to PowerPoint.',
      parameters: Type.Object({
        file: Type.String({ minLength: 1, maxLength: 4096 }),
        output: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 }))
      }, { additionalProperties: false }),
      async execute(_toolCallId, params, signal) {
        const result = await options.presentationService.export(
          options.projectPath,
          { path: params.file, outputPath: params.output },
          signal
        )
        return toolText({ file: params.file, output: result.outputPath })
      }
    })
  }
}
