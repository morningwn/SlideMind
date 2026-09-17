import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  ProjectFileChangedEvent,
  ProjectMutationSource,
} from '../../shared/project'
import type {
  RestoreProjectVersionInput,
  RestoreProjectVersionResult,
} from '../../shared/project-version'
import {
  isVersionedProjectPath,
  normalizeVersionedPath,
  type ProjectVersionService,
} from './project-version-service'
import { getLogger } from '../logging/logger'

const INTERNAL_ECHO_TTL_MS = 3_000
const logger = getLogger('project-mutation')

interface ProjectMutationInput {
  projectPath: string
  projectHandle: string
  paths: readonly string[]
  source: ProjectMutationSource
}

export class ProjectMutationService {
  private readonly internalEchoes = new Map<
    string,
    {
      expiresAt: number
      revision?: string
    }
  >()
  private readonly listeners = new Set<
    (event: ProjectFileChangedEvent) => void
  >()

  constructor(private readonly versions: ProjectVersionService) {}

  onChanged(listener: (event: ProjectFileChangedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  restoreVersion(
    projectPath: string,
    projectHandle: string,
    input: RestoreProjectVersionInput,
  ): Promise<RestoreProjectVersionResult> {
    const paths = input.files.map((file) => file.path)
    return this.run(
      {
        projectPath,
        projectHandle,
        paths,
        source: 'restore',
      },
      () => this.versions.restoreFiles(projectPath, input),
      (result) => result.ok && result.restoredPaths.length > 0,
    )
  }

  async run<T>(
    input: ProjectMutationInput,
    operation: () => Promise<T>,
    didCommit: (result: T) => boolean = () => true,
  ): Promise<T> {
    const paths = [
      ...new Set(
        input.paths
          .map((path) => normalizeVersionedPath(input.projectPath, path))
          .filter(isVersionedProjectPath),
      ),
    ]
    const existed = new Map<string, boolean>()
    await Promise.all(
      paths.map(async (path) => {
        existed.set(
          path,
          await lstat(resolve(input.projectPath, path)).then(
            () => true,
            () => false,
          ),
        )
      }),
    )

    try {
      await this.versions.ensureBaseline(input.projectPath, paths)
    } catch (error) {
      logger.warn('version.baseline_failed', {
        error,
        context: { fileCount: paths.length, source: input.source },
      })
    }

    const expiresAt = Date.now() + INTERNAL_ECHO_TTL_MS
    for (const path of paths) {
      this.internalEchoes.set(this.echoKey(input.projectPath, path), {
        expiresAt,
      })
    }

    let result: T
    try {
      result = await operation()
    } catch (error) {
      for (const path of paths)
        this.internalEchoes.delete(this.echoKey(input.projectPath, path))
      throw error
    }

    if (!didCommit(result)) {
      for (const path of paths)
        this.internalEchoes.delete(this.echoKey(input.projectPath, path))
      return result
    }

    const existsAfter = new Map<string, boolean>()
    await Promise.all(
      paths.map(async (path) => {
        try {
          const revision = await this.fileRevision(
            resolve(input.projectPath, path),
          )
          this.internalEchoes.set(this.echoKey(input.projectPath, path), {
            expiresAt,
            revision,
          })
          existsAfter.set(path, revision !== 'missing')
        } catch (error) {
          this.internalEchoes.delete(this.echoKey(input.projectPath, path))
          logger.warn('version.internal_echo_failed', { error })
        }
      }),
    )

    this.versions.record(input.projectPath, paths, input.source)
    for (const path of paths) {
      const existedBefore = existed.get(path) ?? false
      const existsNow = existsAfter.get(path) ?? false
      this.emit({
        projectHandle: input.projectHandle,
        path,
        kind:
          existedBefore && !existsNow
            ? 'remove'
            : !existedBefore && existsNow
              ? 'add'
              : 'change',
        source: input.source,
      })
    }
    return result
  }

  async isInternalEcho(
    projectPath: string,
    pathInput: string,
  ): Promise<boolean> {
    let path: string
    try {
      path = normalizeVersionedPath(projectPath, pathInput)
    } catch {
      return false
    }

    const key = this.echoKey(projectPath, path)
    const echo = this.internalEchoes.get(key)
    if (!echo) return false
    if (echo.expiresAt < Date.now()) {
      this.internalEchoes.delete(key)
      return false
    }
    if (echo.revision === undefined) return true
    const currentRevision = await this.fileRevision(resolve(projectPath, path))
    if (currentRevision === echo.revision) return true
    this.internalEchoes.delete(key)
    return false
  }

  private emit(event: ProjectFileChangedEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private echoKey(projectPath: string, path: string): string {
    return `${projectPath}\0${path}`
  }

  private async fileRevision(path: string): Promise<string> {
    try {
      const bytes = await readFile(path)
      return createHash('sha256').update(bytes).digest('hex')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
      throw error
    }
  }
}
