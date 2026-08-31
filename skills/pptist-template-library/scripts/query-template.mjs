import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const [, , command, templateId, value] = process.argv

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function validateTemplateId(id) {
  if (!/^template_[1-8]$/.test(id ?? '')) {
    fail('模板 ID 必须是 template_1 到 template_8')
  }
}

async function loadTemplate(id) {
  validateTemplateId(id)
  const content = await readFile(join(skillDirectory, 'assets', `${id}.json`), 'utf8')
  return JSON.parse(content)
}

function roleOf(element) {
  if (element.type === 'text') return element.textType
  if (element.type === 'shape') return element.text?.type
  return undefined
}

function summarizeSlide(slide, index) {
  const textRoles = {}
  const imageRoles = {}
  const elementTypes = {}

  for (const element of slide.elements) {
    elementTypes[element.type] = (elementTypes[element.type] ?? 0) + 1
    const textRole = roleOf(element)
    if (textRole) textRoles[textRole] = (textRoles[textRole] ?? 0) + 1
    if (element.type === 'image' && element.imageType) {
      imageRoles[element.imageType] = (imageRoles[element.imageType] ?? 0) + 1
    }
  }

  return {
    index,
    type: slide.type ?? 'unmarked',
    textRoles,
    imageRoles,
    elementTypes,
  }
}

if (command === 'slides') {
  const template = await loadTemplate(templateId)
  const allowedTypes = new Set(['cover', 'contents', 'transition', 'content', 'end'])
  if (value && !allowedTypes.has(value)) fail('页面类型无效')
  const summaries = template.slides
    .map((slide, index) => summarizeSlide(slide, index))
    .filter((slide) => !value || slide.type === value)
  process.stdout.write(`${JSON.stringify({ templateId, theme: template.theme, slides: summaries }, null, 2)}\n`)
}
else if (command === 'get') {
  const template = await loadTemplate(templateId)
  const index = Number(value)
  if (!Number.isInteger(index) || index < 0 || index >= template.slides.length) {
    fail(`页面索引必须是 0 到 ${template.slides.length - 1}`)
  }
  process.stdout.write(`${JSON.stringify({
    templateId,
    theme: template.theme,
    slide: template.slides[index],
  }, null, 2)}\n`)
}
else {
  fail('用法：query-template.mjs slides <template_1..8> [page-type] | get <template_1..8> <zero-based-index>')
}
