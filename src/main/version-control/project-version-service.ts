import * as fs from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  add,
  commit,
  init,
  remove,
  resolveRef,
  statusMatrix
} from 'isomorphic-git'
import type { ProjectMutationSource } from '../../shared/project'

const VERSION_DIRECTORY = join('.slideMind', 'history.git')
const VERSION_DELAY_MS = 800
const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.slidemind',
  'coverage',
  'node_modules',
  'out',
  'release-dist'
])

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
    await this.commit(gitdir, projectPath, message)
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
