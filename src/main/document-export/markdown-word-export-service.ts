import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ExportMarkdownWordInput,
  ExportMarkdownWordResult,
} from '../../shared/document-export'
import { getLogger } from '../logging/logger'
import {
  readMarkdownExportImage,
  ProjectTextFileStore,
} from '../project/project-text-files'
import type { ProjectMutationService } from '../version-control/project-mutation-service'
import { documentExportFailure, DocumentExportError } from './errors'
import { preparePandocDocument } from './pandoc-document'
import { PandocRuntime } from './pandoc-runtime'
import { resolveWordOutputPath } from './word-export-path'

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_DOCX_BYTES = 50 * 1024 * 1024
const MAX_ACTIVE_EXPORTS = 2
const logger = getLogger('document-export')

interface OutputRevision {
  ctimeMs: number
  ino: number
  mtimeMs: number
  size: number
}

interface ActiveExport {
  controller: AbortController
  done: Promise<void>
  operationId: string
  resolveDone: () => void
}

function validateInput(value: unknown): ExportMarkdownWordInput {
  if (!value || typeof value !== 'object') {
    throw new DocumentExportError('invalid_input', 'Word 导出参数无效')
  }
  const input = value as Partial<ExportMarkdownWordInput>
  if (
    typeof input.path !== 'string' ||
    !input.path.trim() ||
    input.path.length > 4096 ||
    input.path.includes('\0') ||
    typeof input.content !== 'string'
  ) {
    throw new DocumentExportError('invalid_input', 'Word 导出参数无效')
  }
  if (!/\.(?:md|markdown)$/i.test(input.path)) {
    throw new DocumentExportError('invalid_input', '只能导出 Markdown 文档')
  }
  if (Buffer.byteLength(input.content, 'utf8') > MAX_MARKDOWN_BYTES) {
    throw new DocumentExportError('input_too_large', 'Markdown 内容超过 2 MiB')
  }
  return { path: input.path, content: input.content }
}

async function outputRevision(path: string): Promise<OutputRevision | null> {
  try {
    const value = await lstat(path)
    if (value.isSymbolicLink() || !value.isFile()) {
      throw new DocumentExportError(
        'output_failed',
        'Word 导出目标必须是普通文件',
      )
    }
    return {
      ctimeMs: value.ctimeMs,
      ino: value.ino,
      mtimeMs: value.mtimeMs,
      size: value.size,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof DocumentExportError) throw error
    throw new DocumentExportError('output_failed', '无法检查 Word 导出目标', {
      cause: error,
    })
  }
}

function revisionsMatch(
  left: OutputRevision | null,
  right: OutputRevision | null,
): boolean {
  if (left === null || right === null) return left === right
  return (
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  )
}

async function validateDocx(path: string): Promise<void> {
  const value = await stat(path)
  if (!value.isFile() || value.size === 0 || value.size > MAX_DOCX_BYTES) {
    throw new DocumentExportError(
      'conversion_failed',
      '生成的 Word 文件大小无效',
    )
  }
  const bytes = await readFile(path)
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    !bytes.includes(Buffer.from('[Content_Types].xml')) ||
    !bytes.includes(Buffer.from('word/document.xml'))
  ) {
    throw new DocumentExportError(
      'conversion_failed',
      '生成的 Word 文件结构无效',
    )
  }
}

export class MarkdownWordExportService {
  private readonly activeByOwner = new Map<number, ActiveExport>()
  private readonly textFiles = new ProjectTextFileStore()

  constructor(
    private readonly runtime: PandocRuntime,
    private readonly mutations?: ProjectMutationService,
  ) {}

  isBusy(ownerId: number): boolean {
    return (
      this.activeByOwner.has(ownerId) ||
      this.activeByOwner.size >= MAX_ACTIVE_EXPORTS
    )
  }

  async export(
    projectPath: string,
    projectHandle: string,
    inputValue: unknown,
    selectedOutputPath: string,
    ownerId: number,
  ): Promise<ExportMarkdownWordResult> {
    if (
      this.activeByOwner.has(ownerId) ||
      this.activeByOwner.size >= MAX_ACTIVE_EXPORTS
    ) {
      return {
        status: 'failed',
        code: 'busy',
        message: '已有 Word 导出任务正在进行',
      }
    }

    const operationId = randomUUID()
    const controller = new AbortController()
    let resolveDone = (): void => undefined
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })
    this.activeByOwner.set(ownerId, {
      controller,
      done,
      operationId,
      resolveDone,
    })
    const startedAt = Date.now()
    logger.info('document_export.started', { operationId })
    try {
      const input = validateInput(inputValue)
      await this.textFiles.read(projectPath, input.path).catch((error) => {
        throw new DocumentExportError(
          'source_unavailable',
          'Markdown 源文件不存在或不可访问',
          { cause: error },
        )
      })
      const output = await resolveWordOutputPath(
        projectPath,
        selectedOutputPath,
      ).catch((error) => {
        if (error instanceof DocumentExportError) throw error
        throw new DocumentExportError('output_failed', 'Word 导出路径不可用', {
          cause: error,
        })
      })
      const initialRevision = await outputRevision(output.outputPath)
      const taskDirectory = await mkdtemp(
        join(tmpdir(), 'slidemind-word-export-'),
      )
      try {
        const ast = await this.runtime.parseMarkdown(
          input.content,
          operationId,
          controller.signal,
        )
        const prepared = await preparePandocDocument(
          ast,
          async (target) => {
            try {
              return await readMarkdownExportImage(
                projectPath,
                input.path,
                target,
              )
            } catch (error) {
              throw new DocumentExportError(
                /仅支持/.test(error instanceof Error ? error.message : '')
                  ? 'resource_unsupported'
                  : 'resource_invalid',
                error instanceof Error ? error.message : 'Markdown 图片无效',
                { cause: error },
              )
            }
          },
          MAX_IMAGE_BYTES,
        )
        const generatedPath = join(taskDirectory, 'output.docx')
        await this.runtime.writeDocx(
          prepared.document,
          generatedPath,
          operationId,
          controller.signal,
        )
        await validateDocx(generatedPath)
        const temporaryPath = `${output.outputPath}.${process.pid}-${randomUUID()}.slidemind-tmp`
        const commit = async (): Promise<void> => {
          try {
            await copyFile(
              generatedPath,
              temporaryPath,
              constants.COPYFILE_EXCL,
            )
            const currentRevision = await outputRevision(output.outputPath)
            if (!revisionsMatch(initialRevision, currentRevision)) {
              throw new DocumentExportError(
                'output_changed',
                '导出目标在转换期间已被其他程序修改',
              )
            }
            await rename(temporaryPath, output.outputPath)
          } catch (error) {
            await unlink(temporaryPath).catch(() => undefined)
            if (error instanceof DocumentExportError) throw error
            throw new DocumentExportError(
              'output_failed',
              '无法写入 Word 导出文件',
              {
                cause: error,
              },
            )
          }
        }
        if (this.mutations && output.projectRelativePath !== undefined) {
          await this.mutations.run(
            {
              projectPath,
              projectHandle,
              paths: [output.projectRelativePath],
              source: 'text-editor',
            },
            commit,
          )
        } else {
          await commit()
        }
        logger.info('document_export.completed', {
          operationId,
          durationMs: Date.now() - startedAt,
          context: {
            imageBytes: prepared.imageBytes,
            warningCount: prepared.warnings.length,
          },
        })
        return {
          status: 'exported',
          outputPath: output.outputPath,
          warnings: prepared.warnings,
        }
      } finally {
        await rm(taskDirectory, { recursive: true, force: true })
      }
    } catch (error) {
      if (error instanceof DocumentExportError) {
        logger.warn('document_export.failed', {
          operationId,
          durationMs: Date.now() - startedAt,
          context: { code: error.code },
        })
        return documentExportFailure(error)
      }
      logger.error('document_export.failed', {
        operationId,
        durationMs: Date.now() - startedAt,
        error,
      })
      throw error
    } finally {
      const active = this.activeByOwner.get(ownerId)
      if (active?.operationId === operationId) {
        active.resolveDone()
        this.activeByOwner.delete(ownerId)
      }
    }
  }

  cancelOwner(ownerId: number): void {
    const active = this.activeByOwner.get(ownerId)
    if (!active) return
    active.controller.abort()
    this.runtime.cancel(active.operationId)
  }

  async close(): Promise<void> {
    const active = [...this.activeByOwner.values()]
    for (const exportTask of active) exportTask.controller.abort()
    await this.runtime.close()
    await Promise.all(active.map((exportTask) => exportTask.done))
  }
}
