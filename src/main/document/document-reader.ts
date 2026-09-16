import { constants } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import {
  DOCUMENT_DEFAULT_MAX_CHARS,
  DOCUMENT_MAX_FILE_BYTES,
  DocumentReadError,
  isDocumentPath,
  normalizeDocumentReadInput,
  type DocumentReadInput,
  type DocumentReadResult,
} from '../../shared/document'
import { resolveRegularProjectFile } from '../project/project-files'
import { diagnosticId, getLogger } from '../logging/logger'
import {
  documentChunk,
  normalizeTikaDocument,
  type NormalizedDocument,
} from './document-content'
import { TikaClient, type TikaParseResult } from './tika-client'
import { TikaRuntime } from './tika-runtime'

const logger = getLogger('document-reader')
const DEFAULT_CACHE_BYTES = 32 * 1024 * 1024
const DEFAULT_QUEUE_LENGTH = 8
const CURSOR_VERSION = 1

interface FileSnapshot {
  bytes: Uint8Array
  file: string
  projectPath: string
  revision: string
  size: number
}

interface CachedDocument extends NormalizedDocument {
  file: string
  mimeType: string
  projectPath: string
  revision: string
  sizeBytes: number
}

interface CursorPayload {
  key: string
  offset: number
  revision: string
  version: number
}

interface ParseTask {
  controller: AbortController
  key: string
  promise: Promise<CachedDocument>
  reject: (error: unknown) => void
  resolve: (value: CachedDocument) => void
  settled: boolean
  snapshot: FileSnapshot
  waiters: number
}

export interface DocumentRuntime {
  restart(): Promise<void>
  run<T>(operation: (baseUrl: string) => Promise<T>): Promise<T>
  stop(): Promise<void>
}

export interface DocumentParser {
  parse(
    baseUrl: string,
    bytes: Uint8Array,
    file: string,
    signal?: AbortSignal,
  ): Promise<TikaParseResult>
}

export interface DocumentReadServiceOptions {
  cacheBytes?: number
  configVersion?: string
  cursorKey?: Uint8Array
  maxQueueLength?: number
  parser?: DocumentParser
  runtime: DocumentRuntime
}

function sameFileState(
  left: {
    ctimeMs: number
    dev: number
    ino: number
    mtimeMs: number
    size: number
  },
  right: {
    ctimeMs: number
    dev: number
    ino: number
    mtimeMs: number
    size: number
  },
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  )
}

async function readBoundedFile(handle: FileHandle): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  while (total <= DOCUMENT_MAX_FILE_BYTES) {
    const chunk = Buffer.allocUnsafe(
      Math.min(64 * 1024, DOCUMENT_MAX_FILE_BYTES + 1 - total),
    )
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, total)
    if (bytesRead === 0) break
    chunks.push(chunk.subarray(0, bytesRead))
    total += bytesRead
  }
  if (total > DOCUMENT_MAX_FILE_BYTES) {
    throw new DocumentReadError(
      'file_too_large',
      '文档必须大于 0 且不超过 30 MiB',
    )
  }
  return Buffer.concat(chunks, total)
}

export async function createDocumentSnapshot(
  projectPathInput: string,
  relativePath: string,
): Promise<FileSnapshot> {
  if (!isDocumentPath(relativePath)) {
    throw new DocumentReadError(
      'unsupported_format',
      '只能读取 .doc、.docx、.xls、.xlsx 或 .pdf 文档',
    )
  }
  const projectPath = await realpath(projectPathInput)
  const file = await resolveRegularProjectFile(projectPath, relativePath)
  const handle = await open(
    file.targetPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  )
  try {
    const before = await handle.stat()
    if (before.size === 0 || before.size > DOCUMENT_MAX_FILE_BYTES) {
      throw new DocumentReadError(
        'file_too_large',
        '文档必须大于 0 且不超过 30 MiB',
      )
    }
    const data = await readBoundedFile(handle)
    const after = await handle.stat()
    const current = await lstat(file.targetPath)
    if (!sameFileState(before, after) || !sameFileState(after, current)) {
      throw new DocumentReadError(
        'file_changed',
        '读取期间文档已发生变化，请重试',
      )
    }
    if (data.byteLength === 0 || data.byteLength > DOCUMENT_MAX_FILE_BYTES) {
      throw new DocumentReadError(
        'file_too_large',
        '文档必须大于 0 且不超过 30 MiB',
      )
    }
    return {
      bytes: data,
      file: file.relativePath,
      projectPath,
      revision: createHash('sha256').update(data).digest('hex'),
      size: data.byteLength,
    }
  } finally {
    await handle.close()
  }
}

export class DocumentReadService {
  private readonly cache = new Map<string, CachedDocument>()
  private readonly cacheBytes: number
  private readonly configVersion: string
  private readonly cursorKey: Uint8Array
  private readonly maxQueueLength: number
  private readonly parser: DocumentParser
  private readonly pending: ParseTask[] = []
  private readonly runtime: DocumentRuntime
  private readonly tasks = new Map<string, ParseTask>()
  private activeTask = false
  private currentCacheBytes = 0

  constructor(options: DocumentReadServiceOptions) {
    this.runtime = options.runtime
    this.parser = options.parser ?? new TikaClient()
    this.cacheBytes = options.cacheBytes ?? DEFAULT_CACHE_BYTES
    this.configVersion = options.configVersion ?? 'tika-4.0.0-document-v2'
    this.cursorKey = options.cursorKey ?? randomBytes(32)
    this.maxQueueLength = options.maxQueueLength ?? DEFAULT_QUEUE_LENGTH
  }

  async parseWebPdf(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
      throw new DocumentReadError(
        'file_too_large',
        '网页 PDF 必须大于 0 且不超过 20 MiB',
      )
    }
    const parsed = await this.runtime.run((baseUrl) => {
      signal.throwIfAborted()
      return this.parser.parse(baseUrl, bytes, 'web-source.pdf', signal)
    })
    signal.throwIfAborted()
    return normalizeTikaDocument(parsed.entries).content
  }

  async read(
    projectPath: string,
    inputValue: DocumentReadInput | unknown,
    signal?: AbortSignal,
  ): Promise<DocumentReadResult> {
    const input = normalizeDocumentReadInput(inputValue)
    if (signal?.aborted)
      throw new DocumentReadError('cancelled', '文档读取已取消')
    const startedAt = Date.now()
    const snapshot = await createDocumentSnapshot(projectPath, input.file)
    const key = this.cacheKey(snapshot)
    let document: CachedDocument
    let offset = 0

    if (input.cursor) {
      const payload = this.decodeCursor(input.cursor)
      if (payload.revision !== snapshot.revision) {
        throw new DocumentReadError(
          'file_changed',
          '文档已发生变化，请从头读取',
        )
      }
      if (payload.key !== key) {
        throw new DocumentReadError(
          'invalid_cursor',
          '文档游标不属于当前项目或文件',
        )
      }
      document =
        this.getCached(key) ??
        (() => {
          throw new DocumentReadError(
            'cursor_expired',
            '文档游标已过期，请从头读取',
          )
        })()
      offset = payload.offset
      if (offset <= 0 || offset >= document.content.length) {
        throw new DocumentReadError('invalid_cursor', '文档游标偏移无效')
      }
    } else {
      document =
        this.getCached(key) ?? (await this.joinParse(snapshot, key, signal))
    }

    const chunk = documentChunk(
      document.content,
      offset,
      input.maxChars ?? DOCUMENT_DEFAULT_MAX_CHARS,
    )
    logger.info('document.read_completed', {
      durationMs: Date.now() - startedAt,
      context: {
        bytes: snapshot.size,
        documentId: diagnosticId(`${snapshot.projectPath}\0${snapshot.file}`),
        extractionStatus: document.extractionStatus,
        mimeType: document.mimeType,
      },
    })
    return {
      content: chunk.content,
      extractionStatus: document.extractionStatus,
      file: document.file,
      metadata: document.metadata,
      mimeType: document.mimeType,
      ...(chunk.nextOffset === undefined
        ? {}
        : {
            nextCursor: this.encodeCursor(
              key,
              document.revision,
              chunk.nextOffset,
            ),
          }),
      revision: document.revision,
      warnings: document.warnings,
    }
  }

  async clearProject(projectPathInput: string): Promise<void> {
    const projectPath = await realpath(projectPathInput)
    for (const [key, value] of this.cache) {
      if (value.projectPath === projectPath) this.deleteCached(key)
    }
  }

  async close(): Promise<void> {
    for (const task of this.tasks.values()) task.controller.abort()
    this.cache.clear()
    this.currentCacheBytes = 0
    await this.runtime.stop()
  }

  private cacheKey(snapshot: FileSnapshot): string {
    return createHash('sha256')
      .update(snapshot.projectPath)
      .update('\0')
      .update(snapshot.file)
      .update('\0')
      .update(snapshot.revision)
      .update('\0')
      .update(this.configVersion)
      .digest('hex')
  }

  private getCached(key: string): CachedDocument | undefined {
    const value = this.cache.get(key)
    if (!value) return undefined
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  private putCached(key: string, value: CachedDocument): void {
    if (value.sizeBytes > this.cacheBytes) return
    this.deleteCached(key)
    this.cache.set(key, value)
    this.currentCacheBytes += value.sizeBytes
    while (this.currentCacheBytes > this.cacheBytes) {
      const oldestKey = this.cache.keys().next().value as string | undefined
      if (!oldestKey) break
      this.deleteCached(oldestKey)
    }
  }

  private deleteCached(key: string): void {
    const value = this.cache.get(key)
    if (!value) return
    this.cache.delete(key)
    this.currentCacheBytes -= value.sizeBytes
  }

  private joinParse(
    snapshot: FileSnapshot,
    key: string,
    signal?: AbortSignal,
  ): Promise<CachedDocument> {
    let task = this.tasks.get(key)
    if (!task) {
      if (this.pending.length >= this.maxQueueLength) {
        throw new DocumentReadError(
          'queue_full',
          '文档读取队列已满，请稍后重试',
        )
      }
      let resolveTask!: (value: CachedDocument) => void
      let rejectTask!: (error: unknown) => void
      const promise = new Promise<CachedDocument>((resolve, reject) => {
        resolveTask = resolve
        rejectTask = reject
      })
      task = {
        controller: new AbortController(),
        key,
        promise,
        reject: rejectTask,
        resolve: resolveTask,
        settled: false,
        snapshot,
        waiters: 0,
      }
      this.tasks.set(key, task)
      this.pending.push(task)
      this.startNextTask()
    }
    return this.waitForTask(task, signal)
  }

  private waitForTask(
    task: ParseTask,
    signal?: AbortSignal,
  ): Promise<CachedDocument> {
    task.waiters += 1
    return new Promise((resolve, reject) => {
      let released = false
      const release = (): void => {
        if (released) return
        released = true
        signal?.removeEventListener('abort', abort)
        task.waiters -= 1
        if (task.waiters === 0 && !task.settled) task.controller.abort()
      }
      const abort = (): void => {
        release()
        reject(new DocumentReadError('cancelled', '文档读取已取消'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      task.promise.then(
        (value) => {
          release()
          resolve(value)
        },
        (error) => {
          release()
          reject(error)
        },
      )
    })
  }

  private startNextTask(): void {
    if (this.activeTask) return
    const task = this.pending.shift()
    if (!task) return
    if (task.controller.signal.aborted) {
      task.settled = true
      task.reject(new DocumentReadError('cancelled', '文档读取已取消'))
      this.tasks.delete(task.key)
      this.startNextTask()
      return
    }

    this.activeTask = true
    void this.parseTask(task).finally(() => {
      task.settled = true
      this.tasks.delete(task.key)
      this.activeTask = false
      this.startNextTask()
    })
  }

  private async parseTask(task: ParseTask): Promise<void> {
    try {
      const parsed = await this.runtime.run((baseUrl) =>
        this.parser.parse(
          baseUrl,
          task.snapshot.bytes,
          task.snapshot.file,
          task.controller.signal,
        ),
      )
      const normalized = normalizeTikaDocument(parsed.entries)
      const document: CachedDocument = {
        ...normalized,
        file: task.snapshot.file,
        mimeType: parsed.mimeType,
        projectPath: task.snapshot.projectPath,
        revision: task.snapshot.revision,
        sizeBytes: Buffer.byteLength(normalized.content, 'utf8'),
      }
      this.putCached(task.key, document)
      task.settled = true
      task.resolve(document)
    } catch (error) {
      if (task.controller.signal.aborted) {
        await this.runtime.restart().catch(() => undefined)
        task.settled = true
        task.reject(new DocumentReadError('cancelled', '文档读取已取消'))
      } else {
        logger.error('document.parse_failed', {
          error,
          context: {
            bytes: task.snapshot.size,
            documentId: diagnosticId(
              `${task.snapshot.projectPath}\0${task.snapshot.file}`,
            ),
          },
        })
        task.settled = true
        task.reject(error)
      }
    }
  }

  private encodeCursor(key: string, revision: string, offset: number): string {
    const body = Buffer.from(
      JSON.stringify({
        key,
        offset,
        revision,
        version: CURSOR_VERSION,
      } satisfies CursorPayload),
    ).toString('base64url')
    const signature = createHmac('sha256', this.cursorKey)
      .update(body)
      .digest('base64url')
    return `${body}.${signature}`
  }

  private decodeCursor(cursor: string): CursorPayload {
    const [body, signature, extra] = cursor.split('.')
    if (!body || !signature || extra) {
      throw new DocumentReadError('invalid_cursor', '文档游标无效')
    }
    const expected = createHmac('sha256', this.cursorKey).update(body).digest()
    let actual: Buffer
    try {
      actual = Buffer.from(signature, 'base64url')
    } catch {
      throw new DocumentReadError('invalid_cursor', '文档游标无效')
    }
    if (
      actual.toString('base64url') !== signature ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new DocumentReadError('invalid_cursor', '文档游标无效')
    }
    let value: unknown
    try {
      value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch {
      throw new DocumentReadError('invalid_cursor', '文档游标无效')
    }
    const payload = value as Partial<CursorPayload>
    if (
      !payload ||
      payload.version !== CURSOR_VERSION ||
      typeof payload.key !== 'string' ||
      !/^[a-f0-9]{64}$/.test(payload.key) ||
      typeof payload.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(payload.revision) ||
      !Number.isInteger(payload.offset) ||
      (payload.offset ?? 0) <= 0
    ) {
      throw new DocumentReadError('invalid_cursor', '文档游标无效')
    }
    return payload as CursorPayload
  }
}

export function createTikaDocumentReadService(
  options: ConstructorParameters<typeof TikaRuntime>[0],
): DocumentReadService {
  return new DocumentReadService({ runtime: new TikaRuntime(options) })
}
