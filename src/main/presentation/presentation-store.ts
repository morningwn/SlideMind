import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  PRESENTATION_FILE_SUFFIX,
  PRESENTATION_FORMAT,
  PRESENTATION_FORMAT_VERSION,
  type CreateProjectPresentationInput,
  type ImportProjectPresentationInput,
  type PptistElement,
  type PptistPresentation,
  type PptistSlide,
  type PresentationDocument,
  type ProjectPresentationFile,
  type SaveProjectPresentationInput,
  type SaveProjectPresentationResult,
} from '../../shared/presentation'

const MAX_PRESENTATION_BYTES = 50 * 1024 * 1024
const MAX_SLIDES = 500
const MAX_ELEMENTS_PER_SLIDE = 5_000
const MAX_JSON_DEPTH = 100
const MAX_JSON_NODES = 500_000
const INTERNAL_PROJECT_DIRECTORY = '.slidemind'
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function validateString(
  value: unknown,
  label: string,
  maxLength = 4096,
): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes('\0')
  ) {
    throw new Error(`${label}无效`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return (
    candidatePath === projectPath ||
    candidatePath.startsWith(`${projectPath}${sep}`)
  )
}

function presentationRevision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function validatePresentationPath(path: string): void {
  if (!path.toLocaleLowerCase().endsWith(PRESENTATION_FILE_SUFFIX)) {
    throw new Error(`演示文稿必须使用 ${PRESENTATION_FILE_SUFFIX} 扩展名`)
  }
}

function validateProjectRelativePath(
  projectPath: string,
  relativePath: string,
): string {
  if (isAbsolute(relativePath)) throw new Error('文件路径无效')
  const lexicalTarget = resolve(projectPath, relativePath)
  if (!isInsideProject(projectPath, lexicalTarget))
    throw new Error('文件路径超出项目范围')

  const normalized = relative(projectPath, lexicalTarget)
  if (
    normalized
      .split(sep)
      .some(
        (segment) => segment.toLocaleLowerCase() === INTERNAL_PROJECT_DIRECTORY,
      )
  ) {
    throw new Error('不能访问 SlideMind 内部文件')
  }
  validatePresentationPath(normalized)
  return normalized
}

async function assertNoSymbolicLinks(
  projectPath: string,
  relativePath: string,
): Promise<void> {
  let currentPath = projectPath
  for (const segment of relativePath.split(sep)) {
    currentPath = resolve(currentPath, segment)
    if ((await lstat(currentPath)).isSymbolicLink()) {
      throw new Error('暂不支持符号链接演示文稿')
    }
  }
}

async function resolveExistingPresentationFile(
  projectPathInput: unknown,
  relativePathInput: unknown,
): Promise<{ relativePath: string; targetPath: string; size: number }> {
  const projectPath = await realpath(
    validateString(projectPathInput, '项目路径'),
  )
  const inputPath = validateString(relativePathInput, '文件路径')
  const relativePath = validateProjectRelativePath(projectPath, inputPath)
  await assertNoSymbolicLinks(projectPath, relativePath)

  const targetPath = await realpath(resolve(projectPath, relativePath))
  if (!isInsideProject(projectPath, targetPath))
    throw new Error('文件路径超出项目范围')
  const stats = await lstat(targetPath)
  if (!stats.isFile()) throw new Error('目标不是普通文件')
  return { relativePath, targetPath, size: stats.size }
}

async function resolveNewPresentationFile(
  projectPathInput: unknown,
  relativePathInput: unknown,
): Promise<{ relativePath: string; targetPath: string }> {
  const projectPath = await realpath(
    validateString(projectPathInput, '项目路径'),
  )
  const inputPath = validateString(relativePathInput, '文件路径')
  const relativePath = validateProjectRelativePath(projectPath, inputPath)
  const parentPath = await realpath(dirname(resolve(projectPath, relativePath)))
  if (!isInsideProject(projectPath, parentPath))
    throw new Error('文件路径超出项目范围')

  const relativeParent = relative(projectPath, parentPath)
  if (relativeParent) await assertNoSymbolicLinks(projectPath, relativeParent)
  return { relativePath, targetPath: resolve(projectPath, relativePath) }
}

function assertSafeJson(value: unknown): void {
  let nodeCount = 0
  const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    nodeCount += 1
    if (nodeCount > MAX_JSON_NODES) throw new Error('演示文稿结构过于复杂')
    if (current.depth > MAX_JSON_DEPTH) throw new Error('演示文稿嵌套层级过深')
    if (Array.isArray(current.value)) {
      for (const child of current.value)
        stack.push({ depth: current.depth + 1, value: child })
      continue
    }
    if (!isRecord(current.value)) continue
    for (const [key, child] of Object.entries(current.value)) {
      if (DANGEROUS_KEYS.has(key)) throw new Error('演示文稿包含不安全字段')
      stack.push({ depth: current.depth + 1, value: child })
    }
  }
}

function assertFiniteDimension(
  value: unknown,
  label: string,
  allowZero = false,
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (allowZero ? value < 0 : value <= 0) ||
    value > 100_000
  ) {
    throw new Error(`${label}无效`)
  }
}

function assertFiniteCoordinate(
  value: unknown,
  label: string,
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > 100_000
  ) {
    throw new Error(`${label}无效`)
  }
}

function assertPptistElement(value: unknown): asserts value is PptistElement {
  if (!isRecord(value)) throw new Error('PPTist 元素格式无效')
  validateString(value.id, 'PPTist 元素标识', 200)
  validateString(value.type, 'PPTist 元素类型', 100)
  assertFiniteCoordinate(value.left, 'PPTist 元素 left')
  assertFiniteCoordinate(value.top, 'PPTist 元素 top')
  assertFiniteDimension(value.width, 'PPTist 元素 width', value.type === 'line')
  if (value.type !== 'line') {
    assertFiniteDimension(value.height, 'PPTist 元素 height', true)
    if (typeof value.rotate !== 'number' || !Number.isFinite(value.rotate)) {
      throw new Error('PPTist 元素 rotate 无效')
    }
  }
}

function assertPptistSlide(value: unknown): asserts value is PptistSlide {
  if (!isRecord(value)) throw new Error('PPTist 幻灯片格式无效')
  validateString(value.id, 'PPTist 幻灯片标识', 200)
  if (!Array.isArray(value.elements)) throw new Error('PPTist 幻灯片元素无效')
  if (value.elements.length > MAX_ELEMENTS_PER_SLIDE)
    throw new Error('单页幻灯片元素过多')
  const elementIds = new Set<string>()
  for (const element of value.elements) {
    assertPptistElement(element)
    if (elementIds.has(element.id)) throw new Error('PPTist 元素标识重复')
    elementIds.add(element.id)
  }
}

function assertPptistPresentation(
  value: unknown,
): asserts value is PptistPresentation {
  if (!isRecord(value)) throw new Error('PPTist 演示文稿格式无效')
  validateString(value.title, '演示文稿标题', 10_000)
  assertFiniteDimension(value.viewportSize, '演示文稿画布宽度')
  if (
    typeof value.viewportRatio !== 'number' ||
    !Number.isFinite(value.viewportRatio) ||
    value.viewportRatio <= 0 ||
    value.viewportRatio > 10
  ) {
    throw new Error('演示文稿画布比例无效')
  }
  if (!isRecord(value.theme)) throw new Error('PPTist 主题格式无效')
  validateString(value.theme.backgroundColor, 'PPTist 主题背景色', 100)
  validateString(value.theme.fontColor, 'PPTist 主题字体颜色', 100)
  if (
    typeof value.theme.fontName !== 'string' ||
    value.theme.fontName.length > 200
  ) {
    throw new Error('PPTist 主题字体无效')
  }
  if (
    !Array.isArray(value.theme.themeColors) ||
    value.theme.themeColors.length === 0 ||
    value.theme.themeColors.length > 100 ||
    value.theme.themeColors.some(
      (color) => typeof color !== 'string' || color.length > 100,
    )
  ) {
    throw new Error('PPTist 主题颜色无效')
  }
  if (!isRecord(value.theme.outline) || !isRecord(value.theme.shadow)) {
    throw new Error('PPTist 主题样式无效')
  }
  if (
    !Array.isArray(value.slides) ||
    value.slides.length === 0 ||
    value.slides.length > MAX_SLIDES
  ) {
    throw new Error('演示文稿页数无效')
  }
  const slideIds = new Set<string>()
  for (const slide of value.slides) {
    assertPptistSlide(slide)
    if (slideIds.has(slide.id)) throw new Error('PPTist 幻灯片标识重复')
    slideIds.add(slide.id)
  }
}

export function normalizePresentationDocument(
  value: unknown,
): PresentationDocument {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('演示文稿必须是可序列化的 JSON 数据')
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PRESENTATION_BYTES) {
    throw new Error('演示文稿超过 50 MiB，无法保存')
  }

  const normalized = JSON.parse(serialized) as unknown
  assertSafeJson(normalized)
  if (!isRecord(normalized)) throw new Error('演示文稿格式无效')
  if (
    normalized.format !== PRESENTATION_FORMAT ||
    normalized.version !== PRESENTATION_FORMAT_VERSION
  ) {
    throw new Error('不支持的 SlideMind 演示文稿版本')
  }
  assertPptistPresentation(normalized.presentation)
  return normalized as unknown as PresentationDocument
}

function serializePresentationDocument(value: unknown): Buffer {
  const document = normalizePresentationDocument(value)
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

export function createBlankPresentationDocument(
  titleInput?: unknown,
): PresentationDocument {
  const title =
    typeof titleInput === 'string' && titleInput.trim()
      ? validateString(titleInput.trim(), '演示文稿标题', 200)
      : '未命名演示文稿'
  return {
    format: PRESENTATION_FORMAT,
    version: PRESENTATION_FORMAT_VERSION,
    presentation: {
      title,
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: {
        themeColors: [
          '#5b9bd5',
          '#ed7d31',
          '#a5a5a5',
          '#ffc000',
          '#4472c4',
          '#70ad47',
        ],
        fontColor: '#333333',
        fontName: '',
        backgroundColor: '#ffffff',
        shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
        outline: { width: 2, color: '#525252', style: 'solid' },
      },
      slides: [{ id: randomUUID(), elements: [] }],
    },
  }
}

function validateCreateInput(value: unknown): CreateProjectPresentationInput {
  if (!isRecord(value)) throw new Error('新建演示文稿参数无效')
  return {
    path: validateString(value.path, '文件路径'),
    ...(value.title === undefined
      ? {}
      : { title: validateString(value.title, '演示文稿标题', 200) }),
  }
}

function validateImportInput(value: unknown): ImportProjectPresentationInput {
  if (!isRecord(value)) throw new Error('导入演示文稿参数无效')
  return {
    path: validateString(value.path, '文件路径'),
    document: normalizePresentationDocument(value.document),
  }
}

function validateSaveInput(value: unknown): SaveProjectPresentationInput {
  if (!isRecord(value)) throw new Error('演示文稿保存参数无效')
  const path = validateString(value.path, '文件路径')
  const revision = validateString(value.revision, '文件修订号', 64)
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('文件修订号无效')
  return {
    path,
    revision,
    document: normalizePresentationDocument(value.document),
  }
}

export class ProjectPresentationStore {
  private readonly writeQueues = new Map<string, Promise<void>>()

  async create(
    projectPathInput: unknown,
    inputValue: unknown,
  ): Promise<ProjectPresentationFile> {
    const input = validateCreateInput(inputValue)
    const { relativePath, targetPath } = await resolveNewPresentationFile(
      projectPathInput,
      input.path,
    )
    const document = createBlankPresentationDocument(input.title)
    const bytes = serializePresentationDocument(document)
    try {
      await writeFile(targetPath, bytes, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('演示文稿已存在，不能覆盖')
      }
      throw error
    }
    return {
      path: relativePath,
      document,
      revision: presentationRevision(bytes),
    }
  }

  async import(
    projectPathInput: unknown,
    inputValue: unknown,
  ): Promise<ProjectPresentationFile> {
    const input = validateImportInput(inputValue)
    const { relativePath, targetPath } = await resolveNewPresentationFile(
      projectPathInput,
      input.path,
    )
    const bytes = serializePresentationDocument(input.document)
    try {
      await writeFile(targetPath, bytes, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('演示文稿已存在，不能覆盖')
      }
      throw error
    }
    return {
      path: relativePath,
      document: input.document,
      revision: presentationRevision(bytes),
    }
  }

  async read(
    projectPathInput: unknown,
    relativePathInput: unknown,
  ): Promise<ProjectPresentationFile> {
    const { relativePath, targetPath, size } =
      await resolveExistingPresentationFile(projectPathInput, relativePathInput)
    if (size > MAX_PRESENTATION_BYTES)
      throw new Error('演示文稿超过 50 MiB，无法打开')
    const bytes = await readFile(targetPath)
    if (bytes.byteLength > MAX_PRESENTATION_BYTES)
      throw new Error('演示文稿超过 50 MiB，无法打开')

    let value: unknown
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown
    } catch {
      throw new Error('演示文稿不是有效的 JSON 文件')
    }
    return {
      path: relativePath,
      document: normalizePresentationDocument(value),
      revision: presentationRevision(bytes),
    }
  }

  save(
    projectPathInput: unknown,
    inputValue: unknown,
  ): Promise<SaveProjectPresentationResult> {
    const input = validateSaveInput(inputValue)
    const queueKey = `${String(projectPathInput)}\0${input.path}`
    const previousWrite = this.writeQueues.get(queueKey) ?? Promise.resolve()
    let result: SaveProjectPresentationResult
    const operation = previousWrite.then(async () => {
      result = await this.write(projectPathInput, input)
    })
    const queue = operation.then(
      () => undefined,
      () => undefined,
    )
    this.writeQueues.set(queueKey, queue)
    void queue.finally(() => {
      if (this.writeQueues.get(queueKey) === queue)
        this.writeQueues.delete(queueKey)
    })
    return operation.then(() => result)
  }

  private async write(
    projectPathInput: unknown,
    input: SaveProjectPresentationInput,
  ): Promise<SaveProjectPresentationResult> {
    const { targetPath } = await resolveExistingPresentationFile(
      projectPathInput,
      input.path,
    )
    const currentBytes = await readFile(targetPath)
    const currentRevision = presentationRevision(currentBytes)
    if (currentRevision !== input.revision) {
      return { ok: false, reason: 'conflict', currentRevision }
    }

    const nextBytes = serializePresentationDocument(input.document)
    const stats = await lstat(targetPath)
    const temporaryPath = `${targetPath}.${process.pid}-${randomUUID()}.slidemind-tmp`
    try {
      await writeFile(temporaryPath, nextBytes, {
        flag: 'wx',
        mode: stats.mode,
      })
      await rename(temporaryPath, targetPath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
    return { ok: true, revision: presentationRevision(nextBytes) }
  }
}

export function defaultPresentationOutputPath(path: string): string {
  const lowerPath = path.toLocaleLowerCase()
  if (!lowerPath.endsWith(PRESENTATION_FILE_SUFFIX)) return `${path}.pptx`
  return `${path.slice(0, -PRESENTATION_FILE_SUFFIX.length)}.pptx`
}

export function isPptxPath(path: string): boolean {
  return extname(path).toLocaleLowerCase() === '.pptx'
}
