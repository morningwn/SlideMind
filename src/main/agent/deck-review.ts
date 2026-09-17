import type {
  PptistElement,
  PresentationDocument,
} from '../../shared/presentation'

export type DeckReviewSeverity = 'blocker' | 'warning' | 'info'

export interface DeckReviewIssue {
  category:
    | 'accessibility'
    | 'bounds'
    | 'content'
    | 'layout'
    | 'performance'
    | 'typography'
  code: string
  elementIds?: string[]
  evidence: string
  message: string
  severity: DeckReviewSeverity
  slideNumber: number
  suggestion: string
}

export interface DeckReviewResult {
  canvas: { height: number; width: number }
  checkedSlideCount: number
  issueCount: number
  issues: DeckReviewIssue[]
  issuesTruncated: boolean
  manualChecks: string[]
  status: 'fail' | 'needs-attention' | 'pass'
  summary: Record<DeckReviewSeverity, number>
  unsupportedForAutomaticRewrite: string[]
}

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

interface ContentBox {
  box: Box
  element: PptistElement
  index: number
  type: string
}

interface IssueAccumulator {
  issues: DeckReviewIssue[]
  summary: Record<DeckReviewSeverity, number>
  total: number
  truncated: boolean
}

const MAX_ISSUES = 250
const MAX_PAIR_COMPARISONS_PER_SLIDE = 20_000
const CANVAS_EPSILON = 0.5
const SEVERITY_ORDER: Record<DeckReviewSeverity, number> = {
  blocker: 0,
  warning: 1,
  info: 2,
}
const CONTENT_TYPES = new Set(['chart', 'latex', 'shape', 'table', 'text'])
const REWRITE_SUPPORTED_TYPES = new Set(['image', 'line', 'shape', 'text'])
const PLACEHOLDER_PATTERN =
  /(?:\b(?:fixme|lorem\s+ipsum|tbd|todo|xxx)\b|点击添加|待补充|待填写|占位(?:符|文字)?|模板(?:标题|正文))/iu

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
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

function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|li)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function elementText(element: PptistElement): { html: string; text: string } {
  const directHtml = typeof element.content === 'string' ? element.content : ''
  const shapeText =
    isRecord(element.text) && typeof element.text.content === 'string'
      ? element.text.content
      : ''
  const html = directHtml || shapeText
  return { html, text: plainText(html) }
}

function textFontSizes(element: PptistElement, html: string): number[] {
  const sizes: number[] = []
  const direct = numberValue(element.fontSize)
  if (direct > 0) sizes.push(direct)
  if (isRecord(element.text)) {
    const nested = numberValue(element.text.fontSize)
    if (nested > 0) sizes.push(nested)
  }
  for (const match of html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
    const size = Number(match[1])
    if (Number.isFinite(size) && size > 0) sizes.push(size)
  }
  return sizes
}

function rotatedBox(element: PptistElement): Box {
  const width = Math.max(0, element.width)
  const height = Math.max(0, numberValue(element.height))
  const centerX = element.left + width / 2
  const centerY = element.top + height / 2
  const radians = (numberValue(element.rotate) * Math.PI) / 180
  const halfWidth =
    (Math.abs(Math.cos(radians)) * width) / 2 +
    (Math.abs(Math.sin(radians)) * height) / 2
  const halfHeight =
    (Math.abs(Math.sin(radians)) * width) / 2 +
    (Math.abs(Math.cos(radians)) * height) / 2
  return {
    bottom: centerY + halfHeight,
    left: centerX - halfWidth,
    right: centerX + halfWidth,
    top: centerY - halfHeight,
  }
}

function lineBox(element: PptistElement): Box | undefined {
  const point = (value: unknown): [number, number] | undefined =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
      ? [value[0], value[1]]
      : undefined
  const start = point(element.start)
  const end = point(element.end)
  if (!start || !end) return undefined
  const points = [start, end]
  for (const candidate of [element.broken, element.broken2]) {
    const value = point(candidate)
    if (value) points.push(value)
  }
  const xs = points.map(([x]) => element.left + x)
  const ys = points.map(([, y]) => element.top + y)
  return {
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
  }
}

function boxArea(box: Box): number {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top)
}

function intersectionArea(left: Box, right: Box): number {
  return (
    Math.max(
      0,
      Math.min(left.right, right.right) - Math.max(left.left, right.left),
    ) *
    Math.max(
      0,
      Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
    )
  )
}

function overflowRatio(box: Box, width: number, height: number): number {
  const area = boxArea(box)
  if (area === 0) return 0
  const inside: Box = {
    bottom: Math.min(height, box.bottom),
    left: Math.max(0, box.left),
    right: Math.min(width, box.right),
    top: Math.max(0, box.top),
  }
  return 1 - Math.min(area, boxArea(inside)) / area
}

function isOutside(box: Box, width: number, height: number): boolean {
  return (
    box.left < -CANVAS_EPSILON ||
    box.top < -CANVAS_EPSILON ||
    box.right > width + CANVAS_EPSILON ||
    box.bottom > height + CANVAS_EPSILON
  )
}

function isBackgroundImage(
  element: PptistElement,
  box: Box,
  width: number,
  height: number,
): boolean {
  if (element.type !== 'image') return false
  if (element.imageType === 'background') return true
  return (
    box.left <= CANVAS_EPSILON &&
    box.top <= CANVAS_EPSILON &&
    box.right >= width - CANVAS_EPSILON &&
    box.bottom >= height - CANVAS_EPSILON
  )
}

function isOpaqueCover(element: PptistElement): boolean {
  if (element.type === 'image') {
    return (
      typeof element.src === 'string' && element.src.startsWith('data:image/')
    )
  }
  if (element.type !== 'shape') return false
  if (numberValue(element.opacity, 1) === 0) return false
  if (typeof element.fill !== 'string') return true
  const fill = element.fill.replaceAll(' ', '').toLocaleLowerCase()
  return (
    fill !== 'transparent' &&
    !/^#[\da-f]{6}00$/i.test(fill) &&
    !/^rgba\([^)]*,0(?:\.0+)?\)$/.test(fill)
  )
}

function excerpt(value: string, limit = 80): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`
}

function estimatedTextHeight(
  text: string,
  width: number,
  fontSize: number,
  html: string,
): number {
  const usableWidth = Math.max(1, width - 20)
  const explicitLines = text.split('\n')
  let lineCount = 0
  for (const line of explicitLines) {
    let estimatedWidth = 0
    for (const character of line || ' ') {
      estimatedWidth += /[\u2e80-\u9fff\uf900-\ufaff]/u.test(character)
        ? fontSize
        : /\s/u.test(character)
          ? fontSize * 0.33
          : fontSize * 0.56
    }
    lineCount += Math.max(1, Math.ceil(estimatedWidth / usableWidth))
  }
  const paragraphCount = Math.max(1, (html.match(/<p(?:\s|>)/gi) ?? []).length)
  return 10 + lineCount * fontSize * 1.2 + (paragraphCount - 1) * 5
}

function pushIssue(target: IssueAccumulator, issue: DeckReviewIssue): void {
  target.total += 1
  target.summary[issue.severity] += 1
  if (target.issues.length < MAX_ISSUES) {
    target.issues.push(issue)
    return
  }
  target.truncated = true
  const replaceIndex = target.issues.findIndex(
    (retained) =>
      SEVERITY_ORDER[retained.severity] > SEVERITY_ORDER[issue.severity],
  )
  if (replaceIndex >= 0) target.issues[replaceIndex] = issue
}

export function reviewPresentationDocument(
  document: PresentationDocument,
): DeckReviewResult {
  const { presentation } = document
  const canvasWidth = presentation.viewportSize
  const canvasHeight = canvasWidth * presentation.viewportRatio
  const review: IssueAccumulator = {
    issues: [],
    summary: { blocker: 0, info: 0, warning: 0 },
    total: 0,
    truncated: false,
  }
  const unsupportedTypes = new Set<string>()
  const reusableImages = new Map<
    string,
    Array<{ elementId: string; slideNumber: number }>
  >()
  let embeddedImageCharacters = 0

  presentation.slides.forEach((slide, slideIndex) => {
    const slideNumber = slideIndex + 1
    if (slide.elements.length === 0) {
      pushIssue(review, {
        category: 'content',
        code: 'empty-slide',
        evidence: '页面不包含任何元素',
        message: '页面为空，无法形成可交付内容。',
        severity: 'blocker',
        slideNumber,
        suggestion: '补充页面内容，或删除该页。',
      })
      return
    }

    let slideTextCharacters = 0
    const contentBoxes: ContentBox[] = []

    slide.elements.forEach((element, index) => {
      if (!REWRITE_SUPPORTED_TYPES.has(element.type))
        unsupportedTypes.add(element.type)
      const box =
        element.type === 'line' ? lineBox(element) : rotatedBox(element)
      const { html, text } = elementText(element)
      slideTextCharacters += text.length

      if (text) {
        if (PLACEHOLDER_PATTERN.test(text)) {
          pushIssue(review, {
            category: 'content',
            code: 'placeholder-text',
            elementIds: [element.id],
            evidence: excerpt(text),
            message: '页面仍包含占位或待办文案。',
            severity: 'blocker',
            slideNumber,
            suggestion: '替换为面向受众的最终文案，或删除该元素。',
          })
        }

        const sizes = textFontSizes(element, html)
        if (sizes.length > 0) {
          const minimumSize = Math.min(...sizes)
          const maximumSize = Math.max(...sizes)
          if (minimumSize < 14) {
            pushIssue(review, {
              category: 'typography',
              code: 'small-text',
              elementIds: [element.id],
              evidence: `最小字号 ${minimumSize}px；文字“${excerpt(text, 40)}”`,
              message: '字号偏小，投影或远距离阅读存在风险。',
              severity: minimumSize < 10 ? 'blocker' : 'warning',
              slideNumber,
              suggestion: '精简文案并放大字号；不要通过继续缩小字号塞入内容。',
            })
          }
          if (element.textType === 'title' && minimumSize < 28) {
            pushIssue(review, {
              category: 'typography',
              code: 'small-title',
              elementIds: [element.id],
              evidence: `标题字号 ${minimumSize}px；标题“${excerpt(text, 40)}”`,
              message: '标题层级不足，可能无法建立清晰的信息层级。',
              severity: 'warning',
              slideNumber,
              suggestion: '增大标题字号，或缩短标题后再放大。',
            })
          }
          const elementHeight = numberValue(element.height)
          if (
            elementHeight > 0 &&
            estimatedTextHeight(text, element.width, maximumSize, html) >
              elementHeight * 1.15
          ) {
            pushIssue(review, {
              category: 'typography',
              code: 'possible-text-overflow',
              elementIds: [element.id],
              evidence: `文本框 ${Math.round(element.width)}×${Math.round(elementHeight)}，约 ${text.length} 字符`,
              message: '按字号、内边距和自动换行估算，文本可能溢出或被缩小。',
              severity: 'warning',
              slideNumber,
              suggestion:
                '缩短文案或增大文本框，并在真实渲染中确认换行和裁切。',
            })
          }
        }
      } else if (element.type === 'text') {
        pushIssue(review, {
          category: 'content',
          code: 'empty-text-element',
          elementIds: [element.id],
          evidence: '文本元素没有可见文字',
          message: '空文本框会增加编辑噪音，也可能是内容丢失。',
          severity: 'warning',
          slideNumber,
          suggestion: '补充预期文字，或删除空文本框。',
        })
      }

      if (!box) return
      if (isOutside(box, canvasWidth, canvasHeight)) {
        const ratio = overflowRatio(box, canvasWidth, canvasHeight)
        const background = isBackgroundImage(
          element,
          box,
          canvasWidth,
          canvasHeight,
        )
        const intentionalDecoration =
          element.type === 'shape' && element.lock === true
        if (!background && !(intentionalDecoration && ratio < 0.5)) {
          const contentElement =
            CONTENT_TYPES.has(element.type) &&
            (element.type !== 'shape' || Boolean(text))
          pushIssue(review, {
            category: 'bounds',
            code: 'element-out-of-bounds',
            elementIds: [element.id],
            evidence: `旋转后边界 [${box.left.toFixed(1)}, ${box.top.toFixed(1)}]–[${box.right.toFixed(1)}, ${box.bottom.toFixed(1)}]，画布 ${canvasWidth}×${canvasHeight.toFixed(1)}`,
            message: '元素超出画布，导出时可能被裁切。',
            severity: contentElement || ratio >= 0.95 ? 'blocker' : 'warning',
            slideNumber,
            suggestion:
              '调整元素位置或尺寸；若是刻意出血装饰，确认不承载信息后可保留。',
          })
        }
      }

      if (CONTENT_TYPES.has(element.type) && text) {
        contentBoxes.push({ box, element, index, type: element.type })
      }
      if (element.type === 'image') {
        const source = typeof element.src === 'string' ? element.src : ''
        const background = isBackgroundImage(
          element,
          box,
          canvasWidth,
          canvasHeight,
        )
        if (source.startsWith('data:image/'))
          embeddedImageCharacters += source.length
        if (source && !background) {
          const uses = reusableImages.get(source) ?? []
          uses.push({ elementId: element.id, slideNumber })
          reusableImages.set(source, uses)
        }
        if (
          !background &&
          !(typeof element.name === 'string' && element.name.trim())
        ) {
          pushIssue(review, {
            category: 'accessibility',
            code: 'missing-image-alt',
            elementIds: [element.id],
            evidence: '非背景图片没有名称或替代文本',
            message: '图片缺少可识别描述，影响可访问性和后续编辑。',
            severity: 'info',
            slideNumber,
            suggestion: '为有信息含义的图片补充简短、具体的替代文本。',
          })
        }
      }
    })

    if (slideTextCharacters > 700) {
      pushIssue(review, {
        category: 'content',
        code: 'high-text-density',
        evidence: `本页可见文字约 ${slideTextCharacters} 字符`,
        message: '页面文字密度过高，可能削弱演示场景下的可读性。',
        severity: 'warning',
        slideNumber,
        suggestion: '保留单一结论，删减低价值细节或拆分页面。',
      })
    }

    const sortedContent = [...contentBoxes].sort(
      (left, right) => left.box.left - right.box.left,
    )
    let overlapComparisons = 0
    let overlapCheckTruncated = false
    overlapPairs: for (
      let leftIndex = 0;
      leftIndex < sortedContent.length;
      leftIndex += 1
    ) {
      const left = sortedContent[leftIndex]
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < sortedContent.length;
        rightIndex += 1
      ) {
        const right = sortedContent[rightIndex]
        if (right.box.left >= left.box.right) break
        overlapComparisons += 1
        if (overlapComparisons > MAX_PAIR_COMPARISONS_PER_SLIDE) {
          overlapCheckTruncated = true
          break overlapPairs
        }
        const overlap = intersectionArea(left.box, right.box)
        const smallerArea = Math.min(boxArea(left.box), boxArea(right.box))
        if (smallerArea <= 0 || overlap / smallerArea < 0.12) continue
        pushIssue(review, {
          category: 'layout',
          code: 'content-overlap',
          elementIds: [left.element.id, right.element.id],
          evidence: `${left.type} 与 ${right.type} 重叠约 ${Math.round((overlap / smallerArea) * 100)}%`,
          message: '两个承载文字的元素明显重叠，可能互相遮挡。',
          severity: 'warning',
          slideNumber,
          suggestion: '重新分配版面空间，并在真实渲染中确认阅读顺序。',
        })
      }
    }

    let layerComparisons = 0
    let layerCheckTruncated = false
    layerPairs: for (const content of contentBoxes) {
      for (
        let coverIndex = content.index + 1;
        coverIndex < slide.elements.length;
        coverIndex += 1
      ) {
        layerComparisons += 1
        if (layerComparisons > MAX_PAIR_COMPARISONS_PER_SLIDE) {
          layerCheckTruncated = true
          break layerPairs
        }
        const cover = slide.elements[coverIndex]
        if (!isOpaqueCover(cover)) continue
        const coverBox = rotatedBox(cover)
        const contentArea = boxArea(content.box)
        if (
          contentArea === 0 ||
          intersectionArea(content.box, coverBox) / contentArea < 0.5
        )
          continue
        pushIssue(review, {
          category: 'layout',
          code: 'content-may-be-covered',
          elementIds: [content.element.id, cover.id],
          evidence: `后置 ${cover.type} 覆盖前置 ${content.type} 的主要区域`,
          message: '元素层级可能遮挡内容。',
          severity: 'warning',
          slideNumber,
          suggestion: '检查图层顺序；将背景和容器置于内容之后会造成遮挡。',
        })
        break
      }
    }

    if (overlapCheckTruncated || layerCheckTruncated) {
      pushIssue(review, {
        category: 'layout',
        code: 'layout-check-truncated',
        evidence: `单页元素组合超过 ${MAX_PAIR_COMPARISONS_PER_SLIDE.toLocaleString('en-US')} 次比较上限`,
        message: '页面过于复杂，自动重叠或图层检查未覆盖全部元素组合。',
        severity: 'warning',
        slideNumber,
        suggestion: '拆分复杂页面，并在真实渲染中逐层检查。',
      })
    }
  })

  for (const uses of reusableImages.values()) {
    if (uses.length < 2) continue
    pushIssue(review, {
      category: 'performance',
      code: 'repeated-embedded-image',
      elementIds: uses.slice(0, 10).map((use) => use.elementId),
      evidence: `同一非背景图片重复使用 ${uses.length} 次，涉及页面 ${[...new Set(uses.map((use) => use.slideNumber))].join('、')}`,
      message: '重复内嵌同一图片会增大演示数据。',
      severity: 'info',
      slideNumber: uses[0].slideNumber,
      suggestion: '确认重复使用确有必要；性能异常时改用更小的图片资源。',
    })
  }

  if (embeddedImageCharacters > 12_000_000) {
    pushIssue(review, {
      category: 'performance',
      code: 'large-embedded-images',
      evidence: `内嵌图片数据约 ${((embeddedImageCharacters * 0.75) / 1024 / 1024).toFixed(1)} MiB`,
      message: '内嵌图片体积较大，可能影响保存、加载和 agent 上下文。',
      severity: 'warning',
      slideNumber: 1,
      suggestion: '压缩超大图片，并避免重复嵌入相同资源。',
    })
  }

  review.issues.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.slideNumber - right.slideNumber ||
      left.code.localeCompare(right.code),
  )

  return {
    canvas: { height: canvasHeight, width: canvasWidth },
    checkedSlideCount: presentation.slides.length,
    issueCount: review.total,
    issues: review.issues,
    issuesTruncated: review.truncated,
    manualChecks: [
      '真实字体替换、字重和行高',
      '文本最终换行、裁切和图片裁切',
      '颜色对比、视觉层级与跨页一致性',
      '导出到 PowerPoint 后的兼容性和动画',
    ],
    status:
      review.summary.blocker > 0
        ? 'fail'
        : review.summary.warning > 0
          ? 'needs-attention'
          : 'pass',
    summary: review.summary,
    unsupportedForAutomaticRewrite: [...unsupportedTypes].sort(),
  }
}
