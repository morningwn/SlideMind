import { isAbsolute, relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type {
  ProjectExternalWatchScope,
  ProjectFileChangedEvent,
  ProjectFileChangeKind
} from '../../shared/project'
import { isVersionedProjectPath } from '../version-control/project-version-service'
import type { ProjectMutationService } from '../version-control/project-mutation-service'
import { getLogger } from '../logging/logger'

const MAX_WATCHED_FILES = 100
const MAX_WATCHED_DIRECTORIES = 100
const logger = getLogger('external-change-monitor')

interface ProjectWatcher {
  projectPath: string
  watcher: FSWatcher
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return candidatePath === projectPath || candidatePath.startsWith(`${projectPath}${sep}`)
}

function normalizeScopePath(projectPath: string, value: unknown, allowEmpty: boolean): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    value.length > 4096 ||
    value.includes('\0') ||
    isAbsolute(value)
  ) {
    throw new Error('外部变化监听路径无效')
  }
  const targetPath = resolve(projectPath, value)
  if (!isInsideProject(projectPath, targetPath)) throw new Error('外部变化监听路径超出项目范围')
  return relative(projectPath, targetPath)
}

function normalizeScope(projectPath: string, value: unknown): ProjectExternalWatchScope {
  if (!value || typeof value !== 'object') throw new Error('外部变化监听范围无效')
  const candidate = value as Partial<ProjectExternalWatchScope>
  if (!Array.isArray(candidate.files) || !Array.isArray(candidate.directories)) {
    throw new Error('外部变化监听范围无效')
  }
  if (
    candidate.files.length > MAX_WATCHED_FILES ||
    candidate.directories.length > MAX_WATCHED_DIRECTORIES
  ) {
    throw new Error('外部变化监听范围过大')
  }
  return {
    files: [...new Set(candidate.files.map((path) => normalizeScopePath(projectPath, path, false)))],
    directories: [...new Set(candidate.directories.map(
      (path) => normalizeScopePath(projectPath, path, true)
    ))]
  }
}

function changeKind(event: string): ProjectFileChangeKind | null {
  if (event === 'add') return 'add'
  if (event === 'change') return 'change'
  if (event === 'unlink') return 'remove'
  if (event === 'addDir') return 'add-directory'
  if (event === 'unlinkDir') return 'remove-directory'
  return null
}

export class ExternalChangeMonitor {
  private readonly listeners = new Set<(event: ProjectFileChangedEvent) => void>()
  private readonly scopeQueues = new Map<string, Promise<void>>()
  private readonly watchers = new Map<string, ProjectWatcher>()

  constructor(
    private readonly mutations: ProjectMutationService,
    private readonly options: { usePolling?: boolean } = {}
  ) {}

  onChanged(listener: (event: ProjectFileChangedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setScope(
    projectPath: string,
    projectHandle: string,
    scopeInput: unknown
  ): Promise<void> {
    const previous = this.scopeQueues.get(projectHandle) ?? Promise.resolve()
    const result = previous.then(
      () => this.replaceScope(projectPath, projectHandle, scopeInput),
      () => this.replaceScope(projectPath, projectHandle, scopeInput)
    )
    const queue = result.then(() => undefined, () => undefined)
    this.scopeQueues.set(projectHandle, queue)
    void queue.finally(() => {
      if (this.scopeQueues.get(projectHandle) === queue) this.scopeQueues.delete(projectHandle)
    })
    return result
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.scopeQueues.values())
    const watchers = [...this.watchers.values()]
    this.watchers.clear()
    await Promise.all(watchers.map(({ watcher }) => watcher.close()))
  }

  private async replaceScope(
    projectPath: string,
    projectHandle: string,
    scopeInput: unknown
  ): Promise<void> {
    const scope = normalizeScope(projectPath, scopeInput)
    const current = this.watchers.get(projectHandle)
    if (current?.projectPath === projectPath && (scope.files.length || scope.directories.length)) {
      return
    }
    if (current) {
      this.watchers.delete(projectHandle)
      await current.watcher.close()
    }
    if (scope.files.length === 0 && scope.directories.length === 0) return

    const watcher = chokidar.watch(projectPath, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (path) => {
        const relativePath = relative(projectPath, path)
        return Boolean(relativePath) && !isVersionedProjectPath(relativePath)
      },
      usePolling: this.options.usePolling ?? false,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    })
    const registered: ProjectWatcher = { projectPath, watcher }
    this.watchers.set(projectHandle, registered)
    watcher.on('all', (event, absolutePath) => {
      void this.handleEvent(projectHandle, registered, event, absolutePath)
    })
    watcher.on('error', (error) => {
      logger.warn('project.external_watch_failed', { error })
    })
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        watcher.once('ready', resolveReady)
        watcher.once('error', rejectReady)
      })
    } catch (error) {
      if (this.watchers.get(projectHandle) === registered) this.watchers.delete(projectHandle)
      await watcher.close()
      throw error
    }
  }

  private async handleEvent(
    projectHandle: string,
    registered: ProjectWatcher,
    eventName: string,
    absolutePath: string
  ): Promise<void> {
    const kind = changeKind(eventName)
    if (!kind) return
    const path = relative(registered.projectPath, absolutePath)
    if (!path || !isVersionedProjectPath(path)) return
    if (await this.mutations.isInternalEcho(registered.projectPath, path)) return

    const changedEvent: ProjectFileChangedEvent = {
      projectHandle,
      path,
      kind,
      source: 'external'
    }
    for (const listener of this.listeners) listener(changedEvent)
  }
}
