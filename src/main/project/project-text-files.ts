import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import type {
  ProjectTextFile,
  ProjectTextFileKind,
  ProjectImageFile,
  SaveProjectTextFileInput,
  SaveProjectTextFileResult
} from '../../shared/project'

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
const MAX_PREVIEW_ASSET_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024
const INTERNAL_PROJECT_DIRECTORY = '.slidemind'
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const SUPPORTED_EXTENSIONS = new Map<string, ProjectTextFileKind>([
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.txt', 'text']
])
const PREVIEW_ASSET_TYPES = new Map<string, string>([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
])

function imageMimeType(
  path: string,
  unsupportedMessage = '当前仅支持 PNG、JPEG、GIF 和 WebP 图片预览'
): string {
  const mimeType = PREVIEW_ASSET_TYPES.get(extname(path).toLocaleLowerCase())
  if (!mimeType) throw new Error(unsupportedMessage)
  return mimeType
}

function validateString(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4096 ||
    value.includes('\0')
  ) {
    throw new Error(`${label}无效`)
  }
  return value
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return candidatePath === projectPath || candidatePath.startsWith(`${projectPath}${sep}`)
}

function documentKind(path: string): ProjectTextFileKind {
  const kind = SUPPORTED_EXTENSIONS.get(extname(path).toLocaleLowerCase())
  if (!kind) throw new Error('当前仅支持 Markdown 和 TXT 文本文件')
  return kind
}

function fileRevision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function validateSaveInput(value: unknown): SaveProjectTextFileInput {
  if (!value || typeof value !== 'object') throw new Error('文件保存内容无效')
  const input = value as Partial<SaveProjectTextFileInput>
  const path = validateString(input.path, '文件路径')
  if (
    typeof input.content !== 'string' ||
    typeof input.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.revision) ||
    typeof input.hasBom !== 'boolean'
  ) {
    throw new Error('文件保存内容无效')
  }
  return { path, content: input.content, revision: input.revision, hasBom: input.hasBom }
}

async function resolveRegularProjectFile(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<{ targetPath: string; relativePath: string; size: number }> {
  const projectPath = await realpath(validateString(projectPathInput, '项目路径'))
  const relativePath = validateString(relativePathInput, '文件路径')
  if (isAbsolute(relativePath)) throw new Error('文件路径无效')

  const lexicalTarget = resolve(projectPath, relativePath)
  if (!isInsideProject(projectPath, lexicalTarget)) throw new Error('文件路径超出项目范围')

  const normalizedRelativePath = relative(projectPath, lexicalTarget)
  const segments = normalizedRelativePath.split(sep)
  if (segments.some((segment) => segment.toLocaleLowerCase() === INTERNAL_PROJECT_DIRECTORY)) {
    throw new Error('不能打开 SlideMind 内部文件')
  }

  let currentPath = projectPath
  for (const segment of segments) {
    currentPath = resolve(currentPath, segment)
    if ((await lstat(currentPath)).isSymbolicLink()) {
      throw new Error('暂不支持打开符号链接文件')
    }
  }

  const targetPath = await realpath(lexicalTarget)
  if (!isInsideProject(projectPath, targetPath)) throw new Error('文件路径超出项目范围')
  const stats = await lstat(targetPath)
  if (!stats.isFile()) throw new Error('目标不是普通文件')

  return { targetPath, relativePath: normalizedRelativePath, size: stats.size }
}

export class ProjectTextFileStore {
  private readonly writeQueues = new Map<string, Promise<void>>()

  async read(projectPathInput: unknown, relativePathInput: unknown): Promise<ProjectTextFile> {
    const { targetPath, relativePath, size } = await resolveRegularProjectFile(
      projectPathInput,
      relativePathInput
    )
    const kind = documentKind(relativePath)
    if (size > MAX_TEXT_FILE_BYTES) throw new Error('文件超过 2 MiB，无法在应用内编辑')
    const bytes = await readFile(targetPath)
    if (bytes.byteLength > MAX_TEXT_FILE_BYTES) throw new Error('文件超过 2 MiB，无法在应用内编辑')
    if (bytes.includes(0)) throw new Error('文件包含二进制内容，无法作为文本打开')

    const hasBom = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)
    const textBytes = hasBom ? bytes.subarray(UTF8_BOM.length) : bytes
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(textBytes)
    } catch {
      throw new Error('文件不是有效的 UTF-8 文本')
    }

    return {
      path: relativePath,
      kind,
      content,
      revision: fileRevision(bytes),
      lineEnding: content.includes('\r\n') ? 'crlf' : 'lf',
      hasBom
    }
  }

  async readImage(
    projectPathInput: unknown,
    relativePathInput: unknown
  ): Promise<ProjectImageFile> {
    const imageFile = await resolveRegularProjectFile(projectPathInput, relativePathInput)
    const mimeType = imageMimeType(imageFile.relativePath)
    if (imageFile.size > MAX_IMAGE_FILE_BYTES) throw new Error('图片超过 20 MiB，无法预览')

    const bytes = await readFile(imageFile.targetPath)
    if (bytes.byteLength > MAX_IMAGE_FILE_BYTES) throw new Error('图片超过 20 MiB，无法预览')
    return {
      path: imageFile.relativePath,
      mimeType,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      size: bytes.byteLength,
      revision: fileRevision(bytes)
    }
  }

  async readPreviewAsset(
    projectPathInput: unknown,
    documentPathInput: unknown,
    assetPathInput: unknown
  ): Promise<string> {
    const documentPath = validateString(documentPathInput, '文档路径')
    const documentFile = await resolveRegularProjectFile(projectPathInput, documentPath)
    documentKind(documentFile.relativePath)

    const rawAssetPath = validateString(assetPathInput, '预览资源路径').split(/[?#]/, 1)[0]
    let decodedAssetPath: string
    try {
      decodedAssetPath = decodeURIComponent(rawAssetPath)
    } catch {
      throw new Error('预览资源路径无效')
    }
    if (isAbsolute(decodedAssetPath) || /^[a-z][a-z0-9+.-]*:/i.test(decodedAssetPath)) {
      throw new Error('预览资源路径无效')
    }

    const relativeAssetPath = join(dirname(documentFile.relativePath), decodedAssetPath)
    const assetFile = await resolveRegularProjectFile(projectPathInput, relativeAssetPath)
    const mimeType = imageMimeType(
      assetFile.relativePath,
      'Markdown 预览仅支持 PNG、JPEG、GIF 和 WebP 图片'
    )
    if (assetFile.size > MAX_PREVIEW_ASSET_BYTES) throw new Error('预览图片超过 5 MiB')

    const bytes = await readFile(assetFile.targetPath)
    if (bytes.byteLength > MAX_PREVIEW_ASSET_BYTES) throw new Error('预览图片超过 5 MiB')
    return `data:${mimeType};base64,${bytes.toString('base64')}`
  }

  save(
    projectPathInput: unknown,
    inputValue: unknown
  ): Promise<SaveProjectTextFileResult> {
    const input = validateSaveInput(inputValue)
    const queueKey = `${String(projectPathInput)}\0${input.path}`
    const previousWrite = this.writeQueues.get(queueKey) ?? Promise.resolve()
    let result: SaveProjectTextFileResult
    const operation = previousWrite.then(async () => {
      result = await this.write(projectPathInput, input)
    })
    const queue = operation.then(() => undefined, () => undefined)
    this.writeQueues.set(queueKey, queue)
    void queue.finally(() => {
      if (this.writeQueues.get(queueKey) === queue) this.writeQueues.delete(queueKey)
    })
    return operation.then(() => result)
  }

  private async write(
    projectPathInput: unknown,
    input: SaveProjectTextFileInput
  ): Promise<SaveProjectTextFileResult> {
    const { targetPath, relativePath } = await resolveRegularProjectFile(projectPathInput, input.path)
    documentKind(relativePath)
    const currentBytes = await readFile(targetPath)
    const currentRevision = fileRevision(currentBytes)
    if (currentRevision !== input.revision) {
      return { ok: false, reason: 'conflict', currentRevision }
    }

    const textBytes = Buffer.from(input.content, 'utf8')
    const nextBytes = input.hasBom ? Buffer.concat([UTF8_BOM, textBytes]) : textBytes
    if (nextBytes.byteLength > MAX_TEXT_FILE_BYTES) {
      throw new Error('文件超过 2 MiB，无法保存')
    }

    const stats = await lstat(targetPath)
    const temporaryPath = `${targetPath}.${process.pid}-${randomUUID()}.slidemind-tmp`
    try {
      await writeFile(temporaryPath, nextBytes, { flag: 'wx', mode: stats.mode })
      await rename(temporaryPath, targetPath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }

    return { ok: true, revision: fileRevision(nextBytes) }
  }
}
