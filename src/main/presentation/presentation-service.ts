import { randomUUID } from 'node:crypto'
import { lstat, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { Worker } from 'node:worker_threads'
import type {
  ExportProjectPresentationInput,
  ExportProjectPresentationResult,
  PresentationChangedEvent,
  ProjectPresentationFile,
  SaveProjectPresentationResult
} from '../../shared/presentation'
import type { ProjectMutationSource } from '../../shared/project'
import type { ProjectMutationService } from '../version-control/project-mutation-service'
import {
  defaultPresentationOutputPath,
  isPptxPath,
  ProjectPresentationStore
} from './presentation-store'

const EXPORT_TIMEOUT_MS = 120_000
const INTERNAL_PROJECT_DIRECTORY = '.slidemind'

interface PresentationExportWorkerResult {
  error?: string
  ok: boolean
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return candidatePath === projectPath || candidatePath.startsWith(`${projectPath}${sep}`)
}

function validateExportInput(value: unknown): ExportProjectPresentationInput {
  if (!isRecord(value)) throw new Error('导出演示文稿参数无效')
  return {
    path: validateString(value.path, '演示文稿路径'),
    ...(value.outputPath === undefined
      ? {}
      : { outputPath: validateString(value.outputPath, '导出路径') })
  }
}

async function resolveOutputPath(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<{ outputPath: string; relativePath: string }> {
  const projectPath = await realpath(validateString(projectPathInput, '项目路径'))
  const inputPath = validateString(relativePathInput, '导出路径')
  if (isAbsolute(inputPath)) throw new Error('导出路径必须位于项目目录内')
  const outputPath = resolve(projectPath, inputPath)
  if (!isInsideProject(projectPath, outputPath)) throw new Error('导出路径超出项目范围')

  const relativePath = relative(projectPath, outputPath)
  if (
    relativePath.split(sep).some((segment) => segment.toLocaleLowerCase() === INTERNAL_PROJECT_DIRECTORY)
  ) {
    throw new Error('不能导出到 SlideMind 内部目录')
  }
  if (!isPptxPath(relativePath)) throw new Error('导出文件必须使用 .pptx 扩展名')

  const parentPath = await realpath(dirname(outputPath))
  if (!isInsideProject(projectPath, parentPath)) throw new Error('导出路径超出项目范围')
  const relativeParent = relative(projectPath, parentPath)
  if (relativeParent) {
    let currentPath = projectPath
    for (const segment of relativeParent.split(sep)) {
      currentPath = resolve(currentPath, segment)
      if ((await lstat(currentPath)).isSymbolicLink()) throw new Error('导出路径不能包含符号链接')
    }
  }
  try {
    const existing = await lstat(outputPath)
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error('导出目标必须是普通文件')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { outputPath, relativePath }
}

function runExportWorker(
  presentation: ProjectPresentationFile['document']['presentation'],
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(resolve(__dirname, 'presentation-export-worker.js'))
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) rejectPromise(error)
      else resolvePromise()
    }
    const abort = (): void => finish(new Error('演示文稿导出已取消'))
    const timeout = setTimeout(
      () => finish(new Error('演示文稿导出超时')),
      EXPORT_TIMEOUT_MS
    )
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }

    worker.once('message', (value: PresentationExportWorkerResult) => {
      if (!value?.ok) finish(new Error(value?.error || '演示文稿导出失败'))
      else finish()
    })
    worker.once('error', (error) => finish(
      error instanceof Error ? error : new Error(String(error))
    ))
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(new Error(`演示文稿导出 Worker 异常退出：${code}`))
    })
    worker.postMessage({ presentation, outputPath })
  })
}

export class PresentationService {
  private readonly listeners = new Set<(event: PresentationChangedEvent) => void>()

  constructor(
    private readonly mutations?: ProjectMutationService,
    private readonly store = new ProjectPresentationStore()
  ) {}

  onChanged(listener: (event: PresentationChangedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  read(projectPath: string, relativePath: unknown): Promise<ProjectPresentationFile> {
    return this.store.read(projectPath, relativePath)
  }

  async create(
    projectPath: string,
    projectHandle: string,
    input: unknown,
    source: ProjectMutationSource = 'presentation-editor'
  ): Promise<ProjectPresentationFile> {
    const path = isRecord(input) && typeof input.path === 'string' ? input.path : undefined
    const operation = () => this.store.create(projectPath, input)
    const created = this.mutations && path
      ? await this.mutations.run({ projectPath, projectHandle, paths: [path], source }, operation)
      : await operation()
    this.emitChanged({ projectHandle, path: created.path })
    return created
  }

  async save(
    projectPath: string,
    projectHandle: string,
    input: unknown,
    source: ProjectMutationSource = 'presentation-editor'
  ): Promise<SaveProjectPresentationResult> {
    const path = isRecord(input) && typeof input.path === 'string' ? input.path : undefined
    const operation = () => this.store.save(projectPath, input)
    const result = this.mutations && path
      ? await this.mutations.run(
          { projectPath, projectHandle, paths: [path], source },
          operation,
          (candidate) => candidate.ok
        )
      : await operation()
    if (result.ok && isRecord(input) && typeof input.path === 'string') {
      this.emitChanged({ projectHandle, path: input.path })
    }
    return result
  }

  async export(
    projectPath: string,
    projectHandle: string,
    inputValue: unknown,
    signal?: AbortSignal,
    source: ProjectMutationSource = 'presentation-editor'
  ): Promise<ExportProjectPresentationResult> {
    const input = validateExportInput(inputValue)
    const presentation = await this.store.read(projectPath, input.path)
    const requestedOutputPath = input.outputPath ?? defaultPresentationOutputPath(presentation.path)
    const output = await resolveOutputPath(projectPath, requestedOutputPath)
    const temporaryPath = `${output.outputPath}.${process.pid}-${randomUUID()}.slidemind-tmp.pptx`
    const operation = async (): Promise<ExportProjectPresentationResult> => {
      try {
        await runExportWorker(presentation.document.presentation, temporaryPath, signal)
        await rename(temporaryPath, output.outputPath)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
      return { outputPath: output.relativePath }
    }
    return this.mutations
      ? this.mutations.run(
          { projectPath, projectHandle, paths: [output.relativePath], source },
          operation
        )
      : operation()
  }

  private emitChanged(event: PresentationChangedEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
