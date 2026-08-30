import PptxGenJS from 'pptxgenjs'
import type { IPageElement, ISlideData, ISlidePage } from '@univerjs/slides'

const PIXELS_PER_INCH = 72
const DEFAULT_TEXT_COLOR = '333333'
const DEFAULT_SHAPE_COLOR = 'DCE7FF'
const DEFAULT_LINE_COLOR = '8EA4CC'

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toInches(value: number | undefined, fallback = 0): number {
  return numberOr(value, fallback) / PIXELS_PER_INCH
}

function normalizeColor(value: string | null | undefined | void, fallback: string): string {
  if (!value) return fallback
  const hex = value.trim().replace(/^#/, '')
  if (/^[a-f0-9]{6}$/i.test(hex)) return hex.toUpperCase()
  if (/^[a-f0-9]{3}$/i.test(hex)) {
    return hex.split('').map((character) => `${character}${character}`).join('').toUpperCase()
  }
  const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i)
  if (!rgb) return fallback
  return rgb.slice(1, 4).map((component) =>
    Math.min(255, Number(component)).toString(16).padStart(2, '0')
  ).join('').toUpperCase()
}

function plainText(element: IPageElement): string {
  if (element.richText?.text) return element.richText.text
  if (element.shape?.text) return element.shape.text
  const stream = element.richText?.rich?.body?.dataStream
  return stream ? stream.replace(/[\r\n\0]+$/g, '') : ''
}

function shapeType(
  pptx: PptxGenJS,
  value: string | undefined
): Parameters<ReturnType<PptxGenJS['addSlide']>['addShape']>[0] {
  const values = new Set<string>(Object.values(pptx.ShapeType))
  return values.has(value ?? '')
    ? value as Parameters<ReturnType<PptxGenJS['addSlide']>['addShape']>[0]
    : pptx.ShapeType.rect
}

function addTextElement(
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: IPageElement,
  text: string
): void {
  if (!text) return
  slide.addText(text, {
    x: toInches(element.left),
    y: toInches(element.top),
    w: Math.max(0.01, toInches(element.width, 220)),
    h: Math.max(0.01, toInches(element.height, 40)),
    rotate: numberOr(element.angle, 0),
    margin: 0,
    breakLine: false,
    fit: 'shrink',
    fontFace: element.richText?.ff ?? 'Arial',
    fontSize: numberOr(element.richText?.fs, 18),
    bold: element.richText?.bl === 1,
    italic: element.richText?.it === 1,
    color: normalizeColor(element.richText?.cl?.rgb, DEFAULT_TEXT_COLOR),
    valign: 'middle'
  })
}

function addShapeElement(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: IPageElement
): void {
  const shape = element.shape
  if (!shape) return
  const outline = shape.shapeProperties.outline
  slide.addShape(shapeType(pptx, shape.shapeType), {
    x: toInches(element.left),
    y: toInches(element.top),
    w: Math.max(0.01, toInches(element.width, 100)),
    h: Math.max(0.01, toInches(element.height, 100)),
    rotate: numberOr(element.angle, 0),
    fill: {
      color: normalizeColor(
        shape.shapeProperties.shapeBackgroundFill.rgb,
        DEFAULT_SHAPE_COLOR
      )
    },
    line: {
      color: normalizeColor(outline?.outlineFill.rgb, DEFAULT_LINE_COLOR),
      width: Math.max(0, numberOr(outline?.weight, 1))
    }
  })
  addTextElement(slide, element, plainText(element))
}

function addImageElement(
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: IPageElement
): void {
  const source = element.image?.imageProperties?.contentUrl
  if (!source?.startsWith('data:image/')) return
  slide.addImage({
    data: source,
    x: toInches(element.left),
    y: toInches(element.top),
    w: Math.max(0.01, toInches(element.width, 100)),
    h: Math.max(0.01, toInches(element.height, 100)),
    rotate: numberOr(element.angle, 0),
    altText: element.description || element.title
  })
}

function addPage(
  pptx: PptxGenJS,
  page: ISlidePage
): void {
  const slide = pptx.addSlide()
  slide.background = {
    color: normalizeColor(page.pageBackgroundFill.rgb, 'FFFFFF')
  }
  const elements = Object.values(page.pageElements)
    .sort((left, right) => left.zIndex - right.zIndex)
  for (const element of elements) {
    if (element.type === 1) {
      addImageElement(slide, element)
    } else if (element.type === 0) {
      addShapeElement(pptx, slide, element)
    } else if (element.type === 2) {
      addTextElement(slide, element, plainText(element))
    }
  }
}

export async function exportPresentationToPptx(
  snapshot: ISlideData,
  outputPath: string
): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.author = 'SlideMind'
  pptx.company = 'SlideMind'
  pptx.subject = snapshot.title
  pptx.title = snapshot.title
  pptx.defineLayout({
    name: 'SLIDEMIND_CUSTOM',
    width: numberOr(snapshot.pageSize.width, 960) / PIXELS_PER_INCH,
    height: numberOr(snapshot.pageSize.height, 540) / PIXELS_PER_INCH
  })
  pptx.layout = 'SLIDEMIND_CUSTOM'

  const body = snapshot.body
  if (!body) throw new Error('演示文稿没有页面数据')
  for (const pageId of body.pageOrder) {
    const page = body.pages[pageId]
    if (!page || page.pageType !== 0) continue
    addPage(pptx, page)
  }
  await pptx.writeFile({ fileName: outputPath, compression: true })
}
