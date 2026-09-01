import { parse } from 'pptxtojson/dist/index.js'

const MAX_SLIDES_PER_READ = 50
const MAX_ELEMENTS_PER_SLIDE = 500
const MAX_TOTAL_TEXT_CHARACTERS = 160_000
const MAX_TEXT_FIELD_CHARACTERS = 10_000
const MAX_TABLE_ROWS = 100
const MAX_TABLE_COLUMNS = 50
const MAX_CHART_SERIES = 30
const MAX_CHART_VALUES = 200

interface TextBudget {
  remaining: number
  truncated: boolean
}

interface SlideContent {
  audios: number
  charts: unknown[]
  formulas: string[]
  images: number
  omittedElementCount: number
  processedElementCount: number
  tables: string[][][]
  texts: string[]
  videos: number
}

export interface PptxReadSummary {
  contentTruncated: boolean
  endSlide: number
  size: { height: number; width: number }
  slides: Array<Record<string, unknown>>
  startSlide: number
  totalSlideCount: number
  truncated: boolean
  usedFonts: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function captureText(value: unknown, budget: TextBudget, limit = MAX_TEXT_FIELD_CHARACTERS): string {
  const text = plainText(value)
  if (!text || budget.remaining <= 0) {
    if (text) budget.truncated = true
    return ''
  }
  const available = Math.min(limit, budget.remaining)
  const captured = text.slice(0, available)
  budget.remaining -= captured.length
  if (captured.length < text.length) budget.truncated = true
  return captured
}

function addUniqueText(target: string[], value: unknown, budget: TextBudget): void {
  const text = captureText(value, budget)
  if (text && !target.includes(text)) target.push(text)
}

function chartDataSummary(value: unknown, budget: TextBudget): unknown[] {
  if (!Array.isArray(value)) return []
  if (value.length > MAX_CHART_SERIES) budget.truncated = true
  return value.slice(0, MAX_CHART_SERIES).map((series) => {
    if (Array.isArray(series)) {
      if (series.length > MAX_CHART_VALUES) budget.truncated = true
      return series.slice(0, MAX_CHART_VALUES).map((point) => (
        Array.isArray(point)
          ? point.slice(0, 4).map((entry) => (
              typeof entry === 'string' ? captureText(entry, budget, 500) : entry
            ))
          : typeof point === 'string' ? captureText(point, budget, 500) : point
      ))
    }
    if (!isRecord(series)) {
      return typeof series === 'string' ? captureText(series, budget, 500) : series
    }
    const key = captureText(series.key, budget, 500)
    if (Array.isArray(series.values) && series.values.length > MAX_CHART_VALUES) {
      budget.truncated = true
    }
    const values = Array.isArray(series.values)
      ? series.values.slice(0, MAX_CHART_VALUES).map((point) => {
          if (!isRecord(point)) return point
          return {
            x: typeof point.x === 'string'
              ? captureText(point.x, budget, 500)
              : typeof point.x === 'number' ? point.x : undefined,
            y: typeof point.y === 'number' ? point.y : undefined
          }
        })
      : []
    return { key, values }
  })
}

function tableSummary(value: unknown, budget: TextBudget): string[][] {
  if (!Array.isArray(value)) return []
  if (value.length > MAX_TABLE_ROWS) budget.truncated = true
  return value.slice(0, MAX_TABLE_ROWS).map((row) => {
    if (!Array.isArray(row)) return []
    if (row.length > MAX_TABLE_COLUMNS) budget.truncated = true
    return row.slice(0, MAX_TABLE_COLUMNS).map((cell) => (
      captureText(isRecord(cell) ? cell.text : cell, budget, 2_000)
    ))
  })
}

function walkElements(
  values: unknown,
  content: SlideContent,
  budget: TextBudget,
  depth = 0
): void {
  if (!Array.isArray(values)) return
  if (depth > 20) {
    if (values.length > 0) budget.truncated = true
    return
  }
  for (let index = 0; index < values.length; index += 1) {
    if (content.processedElementCount >= MAX_ELEMENTS_PER_SLIDE) {
      content.omittedElementCount += values.length - index
      budget.truncated = true
      return
    }
    const element = values[index]
    if (!isRecord(element)) continue
    content.processedElementCount += 1
    const type = typeof element.type === 'string' ? element.type : 'unknown'
    if (type === 'text' || type === 'shape') {
      addUniqueText(content.texts, element.content, budget)
    } else if (type === 'table') {
      content.tables.push(tableSummary(element.data, budget))
    } else if (type === 'chart') {
      content.charts.push({
        type: element.chartType,
        data: chartDataSummary(element.data, budget)
      })
    } else if (type === 'math') {
      const formula = captureText(element.latex, budget)
      if (formula) content.formulas.push(formula)
      addUniqueText(content.texts, element.text, budget)
    } else if (type === 'image') {
      content.images += 1
    } else if (type === 'video') {
      content.videos += 1
    } else if (type === 'audio') {
      content.audios += 1
    }

    if (type === 'diagram' && Array.isArray(element.textList)) {
      for (const text of element.textList) addUniqueText(content.texts, text, budget)
    }
    if (type === 'group' || type === 'diagram') {
      walkElements(element.elements, content, budget, depth + 1)
    }
  }
}

export async function summarizePptxBytes(
  bytes: ArrayBuffer,
  startSlideInput = 1,
  endSlideInput?: number
): Promise<PptxReadSummary> {
  const parsed = await parse(bytes, {
    imageMode: 'none',
    videoMode: 'none',
    audioMode: 'none'
  })
  const totalSlideCount = parsed.slides.length
  if (totalSlideCount === 0) throw new Error('PPTX 中没有可读取的幻灯片')
  if (!Number.isInteger(startSlideInput) || startSlideInput < 1) {
    throw new Error('起始页无效')
  }
  if (startSlideInput > totalSlideCount) {
    throw new Error(`起始页超出演示文稿页数（共 ${totalSlideCount} 页）`)
  }
  if (endSlideInput !== undefined && (!Number.isInteger(endSlideInput) || endSlideInput < 1)) {
    throw new Error('结束页无效')
  }
  const startSlide = startSlideInput
  const endSlide = Math.min(
    totalSlideCount,
    endSlideInput ?? startSlide + MAX_SLIDES_PER_READ - 1
  )
  if (endSlide < startSlide) throw new Error('结束页不能早于起始页')
  if (endSlide - startSlide + 1 > MAX_SLIDES_PER_READ) {
    throw new Error(`单次最多读取 ${MAX_SLIDES_PER_READ} 页幻灯片`)
  }

  const budget: TextBudget = {
    remaining: MAX_TOTAL_TEXT_CHARACTERS,
    truncated: false
  }
  const slides = parsed.slides.slice(startSlide - 1, endSlide).map((slide, index) => {
    const content: SlideContent = {
      audios: 0,
      charts: [],
      formulas: [],
      images: 0,
      omittedElementCount: 0,
      processedElementCount: 0,
      tables: [],
      texts: [],
      videos: 0
    }
    const notes = captureText(slide.note, budget)
    const elements = [...slide.elements, ...slide.layoutElements]
      .sort((left, right) => left.order - right.order)
    walkElements(elements, content, budget)
    return {
      audios: content.audios,
      charts: content.charts,
      formulas: content.formulas,
      images: content.images,
      number: startSlide + index,
      notes,
      omittedElementCount: content.omittedElementCount,
      tables: content.tables,
      texts: content.texts,
      videos: content.videos
    }
  })
  if (parsed.usedFonts.length > 100) budget.truncated = true
  const usedFonts = parsed.usedFonts
    .slice(0, 100)
    .map((font) => captureText(font, budget, 200))
    .filter(Boolean)

  return {
    contentTruncated: budget.truncated,
    endSlide,
    size: parsed.size,
    slides,
    startSlide,
    totalSlideCount,
    truncated: startSlide > 1 || endSlide < totalSlideCount,
    usedFonts
  }
}
