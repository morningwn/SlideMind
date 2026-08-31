import { randomUUID } from 'node:crypto'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import {
  type PptistElement,
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
      type: 'line'
      x1: number
      y1: number
      x2: number
      y2: number
      color?: string
      lineWidth?: number
      style?: 'solid' | 'dashed' | 'dotted'
      routing?: 'straight' | 'orthogonal'
      startMarker?: 'none' | 'arrow' | 'dot'
      endMarker?: 'none' | 'arrow' | 'dot'
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function textHtml(value: string, options?: {
  bold?: boolean
  color?: string
  fontFamily?: string
  fontSize?: number
  italic?: boolean
}): string {
  const styles = [
    options?.fontSize ? `font-size: ${options.fontSize}px` : '',
    options?.fontFamily ? `font-family: ${escapeHtml(options.fontFamily)}` : '',
    options?.color ? `color: ${escapeHtml(options.color)}` : '',
    options?.bold ? 'font-weight: bold' : '',
    options?.italic ? 'font-style: italic' : ''
  ].filter(Boolean).join('; ')
  const content = escapeHtml(value).replace(/\r?\n/g, '<br>')
  return `<p${styles ? ` style="${styles}"` : ''}>${content}</p>`
}

function createElement(element: SlideInput['elements'][number]): PptistElement {
  if (element.type === 'line') {
    if (element.x1 === element.x2 && element.y1 === element.y2) {
      throw new Error('线条起点和终点不能重合')
    }
    const left = Math.min(element.x1, element.x2)
    const top = Math.min(element.y1, element.y2)
    const start: [number, number] = [element.x1 - left, element.y1 - top]
    const end: [number, number] = [element.x2 - left, element.y2 - top]
    const marker = (value: typeof element.startMarker): '' | 'arrow' | 'dot' =>
      value === 'arrow' || value === 'dot' ? value : ''
    const routing = element.routing ?? 'straight'
    const deltaX = Math.abs(element.x2 - element.x1)
    const deltaY = Math.abs(element.y2 - element.y1)

    return {
      id: randomUUID(),
      type: 'line',
      left,
      top,
      start,
      end,
      points: [marker(element.startMarker), marker(element.endMarker)],
      color: element.color ?? '#8EA4CC',
      style: element.style ?? 'solid',
      width: element.lineWidth ?? 2,
      ...(routing === 'orthogonal' && deltaX > 0 && deltaY > 0
        ? {
            broken2: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
            broken2Direction: deltaX >= deltaY ? 'horizontal' : 'vertical'
          }
        : {})
    }
  }

  const base = {
    id: randomUUID(),
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    rotate: element.rotation ?? 0
  }
  if (element.type === 'text') {
    return {
      ...base,
      type: 'text',
      content: textHtml(element.text, element),
      defaultFontName: element.fontFamily ?? '',
      defaultColor: element.color ?? '#333333'
    }
  }
  if (element.type === 'shape') {
    return {
      ...base,
      type: 'shape',
      viewBox: [200, 200],
      path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
      pathFormula: element.shape === 'roundRect' ? 'roundRect' : undefined,
      fixedRatio: false,
      fill: element.fill ?? '#DCE7FF',
      outline: {
        color: element.lineColor ?? '#8EA4CC',
        width: element.lineWidth ?? 1,
        style: 'solid'
      },
      text: element.text
        ? {
            content: textHtml(element.text, {
              color: element.color,
              fontSize: element.fontSize
            }),
            defaultFontName: '',
            defaultColor: element.color ?? '#333333',
            align: 'middle'
          }
        : undefined
    }
  }
  if (!element.source.startsWith('data:image/')) {
    throw new Error('图片 source 当前仅支持 data:image/... URL')
  }
  return {
    ...base,
    type: 'image',
    src: element.source,
    fixedRatio: false,
    name: element.alt ?? ''
  }
}

function slidesToDocument(
  current: PresentationDocument,
  title: string,
  slides: SlideInput[]
): PresentationDocument {
  return {
    ...current,
    presentation: {
      ...current.presentation,
      title,
      slides: slides.map((slide) => ({
        id: randomUUID(),
        elements: slide.elements.map(createElement),
        ...(slide.background
          ? { background: { type: 'solid', color: slide.background } }
          : {}),
        name: slide.title
      }))
    }
  }
}

function plainText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim()
    : ''
}

function presentationSummary(document: PresentationDocument): Record<string, unknown> {
  const presentation = document.presentation
  return {
    title: presentation.title,
    viewportSize: presentation.viewportSize,
    viewportRatio: presentation.viewportRatio,
    slides: presentation.slides.map((slide, index) => ({
      id: slide.id,
      title: typeof slide.name === 'string' ? slide.name : `第 ${index + 1} 页`,
      background: typeof slide.background === 'object' ? slide.background : undefined,
      elements: slide.elements.map((element) => {
        if (element.type === 'line') {
          const start = Array.isArray(element.start) ? element.start : [0, 0]
          const end = Array.isArray(element.end) ? element.end : [0, 0]
          return {
            id: element.id,
            type: element.type,
            x1: element.left + Number(start[0]),
            y1: element.top + Number(start[1]),
            x2: element.left + Number(end[0]),
            y2: element.top + Number(end[1]),
            color: element.color,
            lineWidth: element.width,
            style: element.style,
            markers: element.points,
            routing: element.broken2
              ? 'orthogonal'
              : element.broken || element.curve || element.cubic ? 'unsupported' : 'straight'
          }
        }
        return {
          id: element.id,
          type: element.type,
          x: element.left,
          y: element.top,
          width: element.width,
          height: element.height,
          rotation: element.rotate ?? 0,
          text: plainText(element.content) || (
            typeof element.text === 'object' && element.text !== null
              ? plainText((element.text as Record<string, unknown>).content)
              : ''
          ),
          fill: element.fill,
          image: element.type === 'image' ? '[embedded image]' : undefined
        }
      })
    }))
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
    const lineMarkerSchema = Type.Union([
      Type.Literal('none'),
      Type.Literal('arrow'),
      Type.Literal('dot')
    ])
    const lineElementSchema = Type.Object({
      type: Type.Literal('line'),
      x1: Type.Number({ minimum: 0, maximum: 100_000 }),
      y1: Type.Number({ minimum: 0, maximum: 100_000 }),
      x2: Type.Number({ minimum: 0, maximum: 100_000 }),
      y2: Type.Number({ minimum: 0, maximum: 100_000 }),
      color: Type.Optional(Type.String({ maxLength: 100 })),
      lineWidth: Type.Optional(Type.Number({ minimum: 0.5, maximum: 100 })),
      style: Type.Optional(Type.Union([
        Type.Literal('solid'),
        Type.Literal('dashed'),
        Type.Literal('dotted')
      ])),
      routing: Type.Optional(Type.Union([
        Type.Literal('straight'),
        Type.Literal('orthogonal')
      ])),
      startMarker: Type.Optional(lineMarkerSchema),
      endMarker: Type.Optional(lineMarkerSchema)
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
        Type.Union([
          textElementSchema,
          shapeElementSchema,
          lineElementSchema,
          imageElementSchema
        ]),
        { maxItems: 5_000 }
      )
    }, { additionalProperties: false })

    pi.registerTool({
      name: 'slides_create',
      label: '新建演示文稿',
      description: '在当前项目中新建一个 SlideMind/PPTist 演示文稿。文件名必须以 .slides.json 结尾。',
      promptSnippet: 'Create an editable PPTist presentation.',
      parameters: Type.Object({
        file: Type.String({ minLength: 1, maxLength: 4096 }),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 }))
      }, { additionalProperties: false }),
      async execute(_toolCallId, params) {
        const created = await options.presentationService.create(
          options.projectPath,
          options.projectHandle,
          { path: params.file, title: params.title },
          'agent'
        )
        return toolText({
          file: created.path,
          revision: created.revision,
          ...presentationSummary(created.document)
        })
      }
    })

    pi.registerTool({
      name: 'slides_read',
      label: '读取演示文稿',
      description: '读取 PPTist 演示文稿结构和当前修订号。写入前必须先读取并使用返回的 revision。',
      promptSnippet: 'Inspect an editable PPTist presentation.',
      parameters: Type.Object({
        file: Type.String({ minLength: 1, maxLength: 4096 })
      }, { additionalProperties: false }),
      async execute(_toolCallId, params) {
        const file = await options.presentationService.read(options.projectPath, params.file)
        return toolText({
          file: file.path,
          revision: file.revision,
          ...presentationSummary(file.document)
        })
      }
    })

    pi.registerTool({
      name: 'slides_write',
      label: '写入演示文稿',
      description: '使用结构化页面替换 PPTist 演示文稿内容。revision 必须来自最近一次 slides_read。',
      promptSnippet: 'Write structured PPTist slides with text, shapes, lines, and embedded images.',
      promptGuidelines: [
        'Use a 1000×562.5 coordinate system unless slides_read reports another canvas size.',
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
        const document = slidesToDocument(current.document, params.title, params.slides as SlideInput[])
        const result = await options.presentationService.save(
          options.projectPath,
          options.projectHandle,
          { path: params.file, revision: params.revision, document },
          'agent'
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
      description: '把当前项目中的 PPTist .slides.json 演示文稿导出为可编辑的 .pptx 文件。',
      promptSnippet: 'Export a PPTist presentation to PowerPoint.',
      parameters: Type.Object({
        file: Type.String({ minLength: 1, maxLength: 4096 }),
        output: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 }))
      }, { additionalProperties: false }),
      async execute(_toolCallId, params, signal) {
        const result = await options.presentationService.export(
          options.projectPath,
          options.projectHandle,
          { path: params.file, outputPath: params.output },
          signal,
          'agent'
        )
        return toolText({ file: params.file, output: result.outputPath })
      }
    })
  }
}
