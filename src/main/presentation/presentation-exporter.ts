import PptxGenJS from 'pptxgenjs'
import type {
  PptistElement,
  PptistPresentation,
  PptistSlide,
} from '../../shared/presentation'

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
    return hex
      .split('')
      .map((character) => `${character}${character}`)
      .join('')
      .toUpperCase()
  }
  const rgb = value.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i,
  )
  if (!rgb) return fallback
  return rgb
    .slice(1, 4)
    .map((component) =>
      Math.min(255, Number(component)).toString(16).padStart(2, '0'),
    )
    .join('')
    .toUpperCase()
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith('#x')) {
        const codePoint = Number.parseInt(entity.slice(2), 16)
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match
      }
      if (entity.startsWith('#')) {
        const codePoint = Number.parseInt(entity.slice(1), 10)
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match
      }
      return named[entity.toLocaleLowerCase()] ?? match
    },
  )
}

export function pptistHtmlToPlainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<\/li\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function elementPosition(element: PptistElement, scale: number) {
  return {
    x: element.left / scale,
    y: element.top / scale,
    w: Math.max(0.01, element.width / scale),
    h: Math.max(0.01, numberOr(element.height, 1) / scale),
    rotate: numberOr(element.rotate, 0),
  }
}

function addTextElement(
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: PptistElement,
  scale: number,
  content = element.content,
  defaultFontName = element.defaultFontName,
  defaultColor = element.defaultColor,
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
    valign:
      element.vAlign === 'bottom' || element.vAlign === 'middle'
        ? element.vAlign
        : 'top',
  })
}

function addShapeElement(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: PptistElement,
  scale: number,
): void {
  const outline = isRecord(element.outline) ? element.outline : undefined
  slide.addShape(pptx.ShapeType.rect, {
    ...elementPosition(element, scale),
    fill: { color: normalizeColor(element.fill, DEFAULT_SHAPE_COLOR) },
    line: {
      color: normalizeColor(outline?.color, DEFAULT_LINE_COLOR),
      width: Math.max(0, numberOr(outline?.width, 1)),
      transparency: outline ? 0 : 100,
    },
  })
  const text = isRecord(element.text) ? element.text : undefined
  if (text) {
    addTextElement(
      slide,
      element,
      scale,
      text.content,
      text.defaultFontName,
      text.defaultColor,
    )
  }
}

function addImageElement(
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: PptistElement,
  scale: number,
): void {
  const source = stringOr(element.src)
  if (!source.startsWith('data:image/')) return
  slide.addImage({
    data: source,
    ...elementPosition(element, scale),
    altText: stringOr(element.name, 'Slide image'),
  })
}

function addLineElement(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS['addSlide']>,
  element: PptistElement,
  scale: number,
): void {
  const point = (value: unknown): [number, number] | undefined =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
      ? [value[0], value[1]]
      : undefined
  const start = point(element.start)
  const end = point(element.end)
  if (!start || !end) return

  const broken = point(element.broken)
  const broken2 = point(element.broken2)
  const linePoints: Array<[number, number]> = [start]
  if (broken) linePoints.push(broken)
  else if (broken2) {
    if (element.broken2Direction === 'vertical') {
      linePoints.push([start[0], broken2[1]], [end[0], broken2[1]])
    } else {
      linePoints.push([broken2[0], start[1]], [broken2[0], end[1]])
    }
  }
  linePoints.push(end)
  const segments = linePoints
    .slice(0, -1)
    .map((from, index) => ({ from, to: linePoints[index + 1] }))
    .filter(({ from, to }) => from[0] !== to[0] || from[1] !== to[1])

  const markers = Array.isArray(element.points) ? element.points : ['', '']
  const markerType = (value: unknown): 'none' | 'triangle' | 'oval' =>
    value === 'arrow' ? 'triangle' : value === 'dot' ? 'oval' : 'none'
  const dashType =
    element.style === 'dotted'
      ? ('sysDot' as const)
      : element.style === 'dashed'
        ? ('dash' as const)
        : ('solid' as const)

  for (let index = 0; index < segments.length; index += 1) {
    const { from, to } = segments[index]
    const deltaX = to[0] - from[0]
    const deltaY = to[1] - from[1]
    const forward = deltaX !== 0 ? deltaX > 0 : deltaY >= 0
    const beginMarker = index === 0 ? markerType(markers[0]) : 'none'
    const endMarker =
      index === segments.length - 1 ? markerType(markers[1]) : 'none'

    slide.addShape(pptx.ShapeType.line, {
      x: (element.left + Math.min(from[0], to[0])) / scale,
      y: (element.top + Math.min(from[1], to[1])) / scale,
      w: Math.abs(deltaX) / scale,
      h: Math.abs(deltaY) / scale,
      flipV: deltaX * deltaY < 0,
      line: {
        color: normalizeColor(element.color, DEFAULT_LINE_COLOR),
        width: Math.max(0.5, numberOr(element.width, 2)),
        dashType,
        beginArrowType: forward ? beginMarker : endMarker,
        endArrowType: forward ? endMarker : beginMarker,
      },
    })
  }
}

function addPage(
  pptx: PptxGenJS,
  slideData: PptistSlide,
  presentation: PptistPresentation,
  scale: number,
): void {
  const slide = pptx.addSlide()
  const background = isRecord(slideData.background)
    ? slideData.background
    : undefined
  slide.background = {
    color: normalizeColor(
      background?.color,
      normalizeColor(presentation.theme.backgroundColor, 'FFFFFF'),
    ),
  }
  for (const element of slideData.elements) {
    if (element.type === 'text') addTextElement(slide, element, scale)
    else if (element.type === 'shape')
      addShapeElement(pptx, slide, element, scale)
    else if (element.type === 'image') addImageElement(slide, element, scale)
    else if (element.type === 'line')
      addLineElement(pptx, slide, element, scale)
  }
}

export async function exportPresentationToPptx(
  presentation: PptistPresentation,
  outputPath: string,
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

  for (const slide of presentation.slides)
    addPage(pptx, slide, presentation, scale)
  await pptx.writeFile({ fileName: outputPath, compression: true })
}
