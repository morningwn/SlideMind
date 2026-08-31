import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import {
  add,
  commit,
  init,
  log,
  readBlob,
  readCommit,
  remove,
  resolveRef,
  statusMatrix
} from 'isomorphic-git'
import type { ProjectMutationSource } from '../../shared/project'
import type {
  CompareProjectVersionFileInput,
  ProjectVersionChange,
  ProjectVersionFileComparison,
  ProjectVersionFileContent,
  ProjectVersionPage,
  ProjectVersionSummary,
  RestoreProjectVersionInput,
  RestoreProjectVersionResult
} from '../../shared/project-version'

const VERSION_DIRECTORY = join('.slideMind', 'history.git')
const VERSION_DELAY_MS = 800
const VERSION_PAGE_SIZE = 30
const VERSION_ID_PATTERN = /^[a-f0-9]{40}$/
const MAX_PREVIEW_BYTES = 1024 * 1024
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.slidemind',
  'coverage',
  'node_modules',
  'out',
  'release-dist'
])
const VERSION_SOURCES = new Set<ProjectMutationSource>([
  'agent',
  'file-tree',
  'import',
  'presentation-editor',
  'restore',
  'text-editor'
])

type VersionChangeTuple = [string | null, string | null, string]

interface VersionCommitWithChanges {
  oid: string
  commit: {
    parent: string[]
    message: string
    committer: { timestamp: number }
    changes?: VersionChangeTuple[]
  }
}

interface VersionCreatedEvent {
  projectPath: string
  versionId: string
}

interface PendingVersion {
  paths: Set<string>
  sources: Set<ProjectMutationSource>
  timer: NodeJS.Timeout
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return candidatePath === projectPath || candidatePath.startsWith(`${projectPath}${sep}`)
}

export function normalizeVersionedPath(projectPath: string, pathInput: unknown): string {
  if (
    typeof pathInput !== 'string' ||
    !pathInput.trim() ||
    pathInput.length > 4096 ||
    pathInput.includes('\0')
  ) {
    throw new Error('版本文件路径无效')
  }

  const targetPath = isAbsolute(pathInput) ? resolve(pathInput) : resolve(projectPath, pathInput)
  if (!isInsideProject(projectPath, targetPath)) throw new Error('版本文件路径超出项目范围')
  return relative(projectPath, targetPath)
}

export function isVersionedProjectPath(path: string): boolean {
  if (!path || path.endsWith('.slidemind-tmp')) return false
  return !path
    .split(/[\\/]/)
    .some((segment) => EXCLUDED_SEGMENTS.has(segment.toLocaleLowerCase()))
}

export class ProjectVersionService {
  private readonly pendingVersions = new Map<string, PendingVersion>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly createdListeners = new Set<(event: VersionCreatedEvent) => void>()

  onCreated(listener: (event: VersionCreatedEvent) => void): () => void {
    this.createdListeners.add(listener)
    return () => this.createdListeners.delete(listener)
  }

  async ensureBaseline(projectPath: string, paths: readonly string[]): Promise<void> {
    const normalizedPaths = this.normalizePaths(projectPath, paths)
    if (normalizedPaths.length === 0) return

    await this.enqueue(projectPath, async () => {
      const gitdir = await this.ensureRepository(projectPath)
      const matrix = await statusMatrix({
        fs,
        dir: projectPath,
        gitdir,
        filepaths: normalizedPaths
      })
      const baselinePaths = matrix
        .filter(([, head, workdir]) => head === 0 && workdir === 2)
        .map(([path]) => path)
      if (baselinePaths.length === 0) return

      for (const path of baselinePaths) {
        await add({ fs, dir: projectPath, gitdir, filepath: path })
      }
      await this.commit(gitdir, projectPath, 'SlideMind baseline')
    })
  }

  record(
    projectPath: string,
    paths: readonly string[],
    source: ProjectMutationSource
  ): void {
    const normalizedPaths = this.normalizePaths(projectPath, paths)
    if (normalizedPaths.length === 0) return

    const current = this.pendingVersions.get(projectPath)
    if (current) {
      clearTimeout(current.timer)
      for (const path of normalizedPaths) current.paths.add(path)
      current.sources.add(source)
      current.timer = this.createTimer(projectPath)
      return
    }

    this.pendingVersions.set(projectPath, {
      paths: new Set(normalizedPaths),
      sources: new Set([source]),
      timer: this.createTimer(projectPath)
    })
  }

  async flush(projectPath: string): Promise<void> {
    const pending = this.pendingVersions.get(projectPath)
    if (!pending) {
      await this.queues.get(projectPath)
      return
    }

    clearTimeout(pending.timer)
    this.pendingVersions.delete(projectPath)
    await this.enqueue(projectPath, () => this.writeVersion(projectPath, pending))
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pendingVersions.keys()].map((projectPath) => this.flush(projectPath)))
    await Promise.all(this.queues.values())
  }

  async listVersions(projectPath: string, cursor?: string): Promise<ProjectVersionPage> {
    if (cursor !== undefined) this.validateVersionId(cursor)
    await this.flush(projectPath)
    const gitdir = join(projectPath, VERSION_DIRECTORY)
    if (!await this.hasRepository(projectPath, gitdir)) {
      return { versions: [], nextCursor: null }
    }

    const commits = await log({
      fs,
      dir: projectPath,
      gitdir,
      ref: cursor ?? 'HEAD',
      depth: VERSION_PAGE_SIZE + 3,
      includeChanges: true
    }) as VersionCommitWithChanges[]
    const visibleCommits = commits
      .filter((entry) => entry.oid !== cursor)
      .filter((entry) => entry.commit.message.trim() !== 'SlideMind baseline')
    const versions = visibleCommits
      .slice(0, VERSION_PAGE_SIZE)
      .map((entry) => this.versionSummary(entry))

    return {
      versions,
      nextCursor: visibleCommits.length > VERSION_PAGE_SIZE
        ? versions.at(-1)?.id ?? null
        : null
    }
  }

  async compareFile(
    projectPath: string,
    input: CompareProjectVersionFileInput
  ): Promise<ProjectVersionFileComparison> {
    const versionId = this.validateVersionId(input.versionId)
    const path = normalizeVersionedPath(projectPath, input.path)
    if (!isVersionedProjectPath(path)) throw new Error('版本文件路径无效')
    if (input.target !== 'current' && input.target !== 'previous') {
      throw new Error('版本比较目标无效')
    }

    await this.flush(projectPath)
    const entry = await this.readVersionCommit(projectPath, versionId)
    const changedPaths = this.versionChanges(entry).map((change) => change.path)
    if (!changedPaths.includes(path)) throw new Error('所选文件不属于该版本')

    const selectedBytes = await this.readVersionBytes(projectPath, versionId, path)
    const currentBytes = await this.readWorkingBytes(projectPath, path)
    const beforeBytes = input.target === 'current'
      ? selectedBytes
      : entry.commit.parent[0]
        ? await this.readVersionBytes(projectPath, entry.commit.parent[0], path)
        : null
    const afterBytes = input.target === 'current' ? currentBytes : selectedBytes

    return {
      path,
      before: this.previewContent(beforeBytes),
      after: this.previewContent(afterBytes),
      currentRevision: this.fileRevision(currentBytes)
    }
  }

  async restoreFiles(
    projectPath: string,
    input: RestoreProjectVersionInput
  ): Promise<RestoreProjectVersionResult> {
    const versionId = this.validateVersionId(input.versionId)
    if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 100) {
      throw new Error('请选择要恢复的文件')
    }

    const files = [...new Map(input.files.map((file) => {
      const path = normalizeVersionedPath(projectPath, file.path)
      if (!isVersionedProjectPath(path) || !/^(?:missing|[a-f0-9]{64})$/.test(file.currentRevision)) {
        throw new Error('版本恢复参数无效')
      }
      return [path, { path, currentRevision: file.currentRevision }]
    })).values()]

    return this.enqueue(projectPath, async () => {
      const entry = await this.readVersionCommit(projectPath, versionId)
      const changedPaths = new Set(this.versionChanges(entry).map((change) => change.path))
      if (files.some((file) => !changedPaths.has(file.path))) {
        throw new Error('所选文件不属于该版本')
      }

      const targets = await Promise.all(files.map(async (file) => {
        const currentBytes = await this.readWorkingBytes(projectPath, file.path)
        return {
          ...file,
          currentBytes,
          targetBytes: await this.readVersionBytes(projectPath, versionId, file.path)
        }
      }))
      const conflicts = targets
        .filter((target) => this.fileRevision(target.currentBytes) !== target.currentRevision)
        .map((target) => target.path)
      if (conflicts.length > 0) return { ok: false, reason: 'conflict', paths: conflicts }

      const changed = targets.filter(
        (target) => this.fileRevision(target.currentBytes) !== this.fileRevision(target.targetBytes)
      )
      const applied: typeof changed = []
      try {
        for (const target of changed) {
          await this.writeWorkingBytes(projectPath, target.path, target.targetBytes)
          applied.push(target)
        }
      } catch (error) {
        const rollbackResults = await Promise.allSettled(applied.reverse().map((target) =>
          this.writeWorkingBytes(projectPath, target.path, target.currentBytes)
        ))
        if (rollbackResults.some((result) => result.status === 'rejected')) {
          throw new Error('版本恢复未完整完成，且部分文件无法自动回滚')
        }
        throw error
      }
      return { ok: true, restoredPaths: changed.map((target) => target.path) }
    })
  }

  private createTimer(projectPath: string): NodeJS.Timeout {
    return setTimeout(() => {
      void this.flush(projectPath).catch((error: unknown) => {
        console.warn('Unable to create SlideMind project version:', error)
      })
    }, VERSION_DELAY_MS)
  }

  private async writeVersion(projectPath: string, pending: PendingVersion): Promise<void> {
    const gitdir = await this.ensureRepository(projectPath)
    const paths = [...pending.paths]
    const matrix = await statusMatrix({ fs, dir: projectPath, gitdir, filepaths: paths })
    let hasChanges = false

    for (const [path, head, workdir] of matrix) {
      if (workdir === 2) {
        await add({ fs, dir: projectPath, gitdir, filepath: path })
        hasChanges = true
      } else if (head === 1 && workdir === 0) {
        await remove({ fs, dir: projectPath, gitdir, filepath: path })
        hasChanges = true
      }
    }

    if (!hasChanges) return
    const sources = [...pending.sources].sort().join(', ')
    const message = `SlideMind auto version (${sources})\n\n${paths.sort().join('\n')}`
    const versionId = await this.commit(gitdir, projectPath, message)
    for (const listener of this.createdListeners) listener({ projectPath, versionId })
  }

  private async ensureRepository(projectPath: string): Promise<string> {
    const gitdir = join(projectPath, VERSION_DIRECTORY)
    await mkdir(join(projectPath, '.slideMind'), { recursive: true, mode: 0o700 })
    try {
      await resolveRef({ fs, dir: projectPath, gitdir, ref: 'HEAD' })
    } catch {
      await init({ fs, dir: projectPath, gitdir, defaultBranch: 'slidemind' })
    }
    return gitdir
  }

  private commit(gitdir: string, projectPath: string, message: string): Promise<string> {
    return commit({
      fs,
      dir: projectPath,
      gitdir,
      message,
      author: {
        name: 'SlideMind',
        email: 'versions@slidemind.local'
      }
    })
  }

  private async hasRepository(projectPath: string, gitdir: string): Promise<boolean> {
    try {
      await resolveRef({ fs, dir: projectPath, gitdir, ref: 'HEAD' })
      return true
    } catch (error) {
      if ((error as { code?: unknown }).code === 'NotFoundError') return false
      throw error
    }
  }

  private async readVersionCommit(
    projectPath: string,
    versionId: string
  ): Promise<VersionCommitWithChanges> {
    const gitdir = join(projectPath, VERSION_DIRECTORY)
    if (!await this.hasRepository(projectPath, gitdir)) throw new Error('项目还没有版本历史')
    await readCommit({ fs, dir: projectPath, gitdir, oid: versionId })
    const entries = await log({
      fs,
      dir: projectPath,
      gitdir,
      ref: versionId,
      depth: 1,
      includeChanges: true
    }) as VersionCommitWithChanges[]
    const entry = entries[0]
    if (!entry || entry.commit.message.trim() === 'SlideMind baseline') {
      throw new Error('版本不存在或不可恢复')
    }
    return entry
  }

  private versionSummary(entry: VersionCommitWithChanges): ProjectVersionSummary {
    return {
      id: entry.oid,
      createdAt: new Date(entry.commit.committer.timestamp * 1000).toISOString(),
      sources: this.versionSources(entry.commit.message),
      changes: this.versionChanges(entry)
    }
  }

  private versionSources(message: string): ProjectMutationSource[] {
    const match = /^SlideMind auto version \(([^)]+)\)/.exec(message.trim())
    if (!match) return []
    return match[1]
      .split(',')
      .map((source) => source.trim())
      .filter((source): source is ProjectMutationSource => VERSION_SOURCES.has(
        source as ProjectMutationSource
      ))
  }

  private versionChanges(entry: VersionCommitWithChanges): ProjectVersionChange[] {
    return (entry.commit.changes ?? [])
      .map(([nextOid, previousOid, path]): ProjectVersionChange => ({
        path,
        kind: previousOid === null
          ? 'added'
          : nextOid === null
            ? 'removed'
            : 'modified'
      }))
      .filter((change) => isVersionedProjectPath(change.path))
      .sort((left, right) => left.path.localeCompare(right.path))
  }

  private async readVersionBytes(
    projectPath: string,
    versionId: string,
    path: string
  ): Promise<Buffer | null> {
    try {
      const result = await readBlob({
        fs,
        dir: projectPath,
        gitdir: join(projectPath, VERSION_DIRECTORY),
        oid: versionId,
        filepath: path
      })
      return Buffer.from(result.blob)
    } catch (error) {
      if ((error as { code?: unknown }).code === 'NotFoundError') return null
      throw error
    }
  }

  private async readWorkingBytes(projectPath: string, path: string): Promise<Buffer | null> {
    const targetPath = await this.safeWorkingPath(projectPath, path)
    try {
      return await readFile(targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private previewContent(bytes: Buffer | null): ProjectVersionFileContent {
    if (bytes === null) return { status: 'missing' }
    if (bytes.byteLength > MAX_PREVIEW_BYTES) {
      return { status: 'too-large', byteLength: bytes.byteLength }
    }
    if (bytes.includes(0)) return { status: 'binary', byteLength: bytes.byteLength }

    const contentBytes = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)
      ? bytes.subarray(UTF8_BOM.length)
      : bytes
    try {
      return {
        status: 'text',
        content: new TextDecoder('utf-8', { fatal: true }).decode(contentBytes),
        byteLength: bytes.byteLength
      }
    } catch {
      return { status: 'binary', byteLength: bytes.byteLength }
    }
  }

  private fileRevision(bytes: Buffer | null): string {
    return bytes === null ? 'missing' : createHash('sha256').update(bytes).digest('hex')
  }

  private async writeWorkingBytes(
    projectPath: string,
    path: string,
    bytes: Buffer | null
  ): Promise<void> {
    const targetPath = await this.safeWorkingPath(projectPath, path)
    if (bytes === null) {
      await unlink(targetPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      return
    }

    const stats = await lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 })
    await this.safeWorkingPath(projectPath, path)
    const temporaryPath = join(
      dirname(targetPath),
      `.${basename(targetPath)}.${process.pid}-${randomUUID()}.slidemind-tmp`
    )
    try {
      await writeFile(temporaryPath, bytes, { flag: 'wx', mode: stats?.mode ?? 0o600 })
      await rename(temporaryPath, targetPath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  private async safeWorkingPath(projectPath: string, path: string): Promise<string> {
    const targetPath = resolve(projectPath, path)
    const segments = relative(projectPath, targetPath).split(sep)
    let currentPath = projectPath
    for (let index = 0; index < segments.length; index += 1) {
      currentPath = resolve(currentPath, segments[index])
      const stats = await lstat(currentPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (!stats) {
        break
      }
      if (stats.isSymbolicLink()) throw new Error('不能恢复符号链接文件')
      if (index < segments.length - 1 && !stats.isDirectory()) {
        throw new Error('版本文件路径无效')
      }
      if (index === segments.length - 1 && !stats.isFile()) {
        throw new Error('只能恢复普通文件')
      }
    }
    return targetPath
  }

  private validateVersionId(input: unknown): string {
    if (typeof input !== 'string' || !VERSION_ID_PATTERN.test(input)) {
      throw new Error('版本标识无效')
    }
    return input
  }

  private normalizePaths(projectPath: string, paths: readonly string[]): string[] {
    return [...new Set(paths
      .map((path) => normalizeVersionedPath(projectPath, path))
      .filter(isVersionedProjectPath))]
  }

  private enqueue<T>(projectPath: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(projectPath) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const queue = result.then(() => undefined, () => undefined)
    this.queues.set(projectPath, queue)
    void queue.finally(() => {
      if (this.queues.get(projectPath) === queue) this.queues.delete(projectPath)
    })
    return result
  }
}
