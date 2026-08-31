import PptxGenJS from 'pptxgenjs'
import type { PptistElement, PptistPresentation, PptistSlide } from '../../shared/presentation'

const DEFAULT_TEXT_COLOR = '333333'
const DEFAULT_SHAPE_COLOR = 'DCE7FF'
const DEFAULT_LINE_COLOR = '8EA4CC'
const STANDARD_LAYOUT_WIDTH = 13.333333

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
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

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"'
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) {
      const codePoint = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return named[entity.toLocaleLowerCase()] ?? match
  })
}

export function pptistHtmlToPlainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function elementPosition(element: PptistElement, scale: number) {
  return {
    x: element.left / scale,
    y: element.top / scale,
    w: Math.max(0.01, element.width / scale),
    h: Math.max(0.01, numberOr(element.height, 1) / scale),
    rotate: numberOr(element.rotate, 0)
  }
}

function addTextElement(
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: PptistElement,
  scale: number,
  content = element.content,
  defaultFontName = element.defaultFontName,
  defaultColor = element.defaultColor
): void {
  const text = pptistHtmlToPlainText(content)
  if (!text) return
  slide.addText(text, {
    ...elementPosition(element, scale),
    margin: 0,
    breakLine: false,
    fit: 'shrink',
    fontFace: stringOr(defaultFontName, 'Arial'),
    fontSize: numberOr(element.fontSize, 18),
    color: normalizeColor(defaultColor, DEFAULT_TEXT_COLOR),
    valign: element.vAlign === 'bottom' || element.vAlign === 'middle'
      ? element.vAlign
      : 'top'
  })
}

function addShapeElement(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: PptistElement,
  scale: number
): void {
  const outline = isRecord(element.outline) ? element.outline : undefined
  slide.addShape(pptx.ShapeType.rect, {
    ...elementPosition(element, scale),
    fill: { color: normalizeColor(element.fill, DEFAULT_SHAPE_COLOR) },
    line: {
      color: normalizeColor(outline?.color, DEFAULT_LINE_COLOR),
      width: Math.max(0, numberOr(outline?.width, 1)),
      transparency: outline ? 0 : 100
    }
  })
  const text = isRecord(element.text) ? element.text : undefined
  if (text) {
    addTextElement(
      slide,
      element,
      scale,
      text.content,
      text.defaultFontName,
      text.defaultColor
    )
  }
}

function addImageElement(
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: PptistElement,
  scale: number
): void {
  const source = stringOr(element.src)
  if (!source.startsWith('data:image/')) return
  slide.addImage({
    data: source,
    ...elementPosition(element, scale),
    altText: stringOr(element.name, 'Slide image')
  })
}

function addLineElement(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: PptistElement,
  scale: number
): void {
  slide.addShape(pptx.ShapeType.line, {
    ...elementPosition(element, scale),
    line: {
      color: normalizeColor(element.color, DEFAULT_LINE_COLOR),
      width: 1
    }
  })
}

function addPage(
  pptx: PptxGenJS,
  slideData: PptistSlide,
  presentation: PptistPresentation,
  scale: number
): void {
  const slide = pptx.addSlide()
  const background = isRecord(slideData.background) ? slideData.background : undefined
  slide.background = {
    color: normalizeColor(background?.color, normalizeColor(
      presentation.theme.backgroundColor,
      'FFFFFF'
    ))
  }
  for (const element of slideData.elements) {
    if (element.type === 'text') addTextElement(slide, element, scale)
    else if (element.type === 'shape') addShapeElement(pptx, slide, element, scale)
    else if (element.type === 'image') addImageElement(slide, element, scale)
    else if (element.type === 'line') addLineElement(pptx, slide, element, scale)
  }
}

export async function exportPresentationToPptx(
  presentation: PptistPresentation,
  outputPath: string
): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.author = 'SlideMind'
  pptx.company = 'SlideMind'
  pptx.subject = presentation.title
  pptx.title = presentation.title

  const width = STANDARD_LAYOUT_WIDTH
  const height = width * presentation.viewportRatio
  const scale = presentation.viewportSize / width
  pptx.defineLayout({ name: 'SLIDEMIND_PPTIST', width, height })
  pptx.layout = 'SLIDEMIND_PPTIST'

  for (const slide of presentation.slides) addPage(pptx, slide, presentation, scale)
  await pptx.writeFile({ fileName: outputPath, compression: true })
}
