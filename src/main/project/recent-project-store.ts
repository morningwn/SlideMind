import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { ProjectInfo } from '../../shared/project'

interface StoredRecentProjects {
  version: 1
  projects: ProjectInfo[]
}

const MAX_RECENT_PROJECTS = 20

function isProjectInfo(value: unknown): value is ProjectInfo {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.lastOpenedAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.lastOpenedAt))
  )
}

function isStoredRecentProjects(value: unknown): value is StoredRecentProjects {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.projects) &&
    candidate.projects.every(isProjectInfo)
  )
}

export async function resolveProject(path: unknown): Promise<ProjectInfo> {
  if (typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0')) {
    throw new Error('项目路径无效')
  }

  try {
    const canonicalPath = await realpath(path)
    const projectStats = await stat(canonicalPath)

    if (!projectStats.isDirectory()) {
      throw new Error('请选择项目文件夹')
    }

    return {
      name: basename(canonicalPath),
      path: canonicalPath,
      lastOpenedAt: new Date().toISOString()
    }
  } catch (error) {
    if (error instanceof Error && error.message === '请选择项目文件夹') throw error
    throw new Error('项目文件夹不存在或无法访问')
  }
}

export class RecentProjectStore {
  private writeQueue = Promise.resolve()

  constructor(private readonly storePath: string) {}

  async list(): Promise<ProjectInfo[]> {
    try {
      const raw = await readFile(this.storePath, 'utf8')
      const stored: unknown = JSON.parse(raw)
      if (!isStoredRecentProjects(stored)) return []

      return [...stored.projects]
        .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt))
        .slice(0, MAX_RECENT_PROJECTS)
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') {
        console.warn('Unable to read recent projects:', error)
      }
      return []
    }
  }

  async record(project: ProjectInfo): Promise<ProjectInfo[]> {
    return this.enqueue(async () => {
      const projects = await this.list()
      const nextProjects = [
        project,
        ...projects.filter((candidate) => candidate.path !== project.path)
      ].slice(0, MAX_RECENT_PROJECTS)
      await this.write(nextProjects)
      return nextProjects
    })
  }

  async remove(path: string): Promise<ProjectInfo[]> {
    return this.enqueue(async () => {
      const projects = await this.list()
      const nextProjects = projects.filter((project) => project.path !== path)
      await this.write(nextProjects)
      return nextProjects
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation)
    this.writeQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async write(projects: ProjectInfo[]): Promise<void> {
    const temporaryPath = `${this.storePath}.tmp`
    const stored: StoredRecentProjects = { version: 1, projects }

    await mkdir(dirname(this.storePath), { recursive: true })
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(temporaryPath, this.storePath)
  }
}
