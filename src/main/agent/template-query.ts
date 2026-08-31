import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const TEMPLATE_IDS = [
  'template_1',
  'template_2',
  'template_3',
  'template_4',
  'template_5',
  'template_6',
  'template_7',
  'template_8'
] as const

export const TEMPLATE_PAGE_TYPES = [
  'cover',
  'contents',
  'transition',
  'content',
  'end'
] as const

export type TemplateId = typeof TEMPLATE_IDS[number]
export type TemplatePageType = typeof TEMPLATE_PAGE_TYPES[number]

type JsonObject = Record<string, unknown>

interface TemplateData {
  slides: JsonObject[]
  theme: unknown
}

export type TemplateQuery = {
  action: 'slides'
  pageType?: TemplatePageType
  templateId: TemplateId
} | {
  action: 'get'
  index: number
  templateId: TemplateId
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(values: Record<string, number>, key: string): void {
  values[key] = (values[key] ?? 0) + 1
}

function roleOf(element: JsonObject): string | undefined {
  if (element.type === 'text' && typeof element.textType === 'string') return element.textType
  if (element.type !== 'shape' || !isObject(element.text)) return undefined
  return typeof element.text.type === 'string' ? element.text.type : undefined
}

function summarizeSlide(slide: JsonObject, index: number) {
  const textRoles: Record<string, number> = {}
  const imageRoles: Record<string, number> = {}
  const elementTypes: Record<string, number> = {}
  const elements = Array.isArray(slide.elements) ? slide.elements.filter(isObject) : []

  for (const element of elements) {
    if (typeof element.type === 'string') count(elementTypes, element.type)
    const textRole = roleOf(element)
    if (textRole) count(textRoles, textRole)
    if (element.type === 'image' && typeof element.imageType === 'string') {
      count(imageRoles, element.imageType)
    }
  }

  return {
    index,
    type: typeof slide.type === 'string' ? slide.type : 'unmarked',
    textRoles,
    imageRoles,
    elementTypes
  }
}

async function loadTemplate(skillsDirectory: string, templateId: TemplateId): Promise<TemplateData> {
  const path = join(
    skillsDirectory,
    'pptist-template-library',
    'assets',
    `${templateId}.json`
  )
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isObject(parsed) || !Array.isArray(parsed.slides) || !parsed.slides.every(isObject)) {
    throw new Error(`内置模板格式无效：${templateId}`)
  }
  return { slides: parsed.slides, theme: parsed.theme }
}

export async function queryTemplate(skillsDirectory: string, query: TemplateQuery) {
  const template = await loadTemplate(skillsDirectory, query.templateId)
  if (query.action === 'slides') {
    const slides = template.slides
      .map((slide, index) => summarizeSlide(slide, index))
      .filter((slide) => !query.pageType || slide.type === query.pageType)
    return { templateId: query.templateId, theme: template.theme, slides }
  }

  if (!Number.isInteger(query.index) || query.index < 0 || query.index >= template.slides.length) {
    throw new Error(`页面索引必须是 0 到 ${template.slides.length - 1}`)
  }
  return {
    templateId: query.templateId,
    theme: template.theme,
    slide: template.slides[query.index]
  }
}
