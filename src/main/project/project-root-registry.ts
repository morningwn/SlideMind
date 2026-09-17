import { randomUUID } from 'node:crypto'
import type { OpenedProject, ProjectInfo } from '../../shared/project'
import { registerSensitivePath } from '../logging/logger'

const MAX_PROJECT_HANDLE_LENGTH = 200

export class ProjectRootRegistry {
  private readonly pathsByHandle = new Map<string, string>()
  private readonly handlesByPath = new Map<string, string>()

  grant(project: ProjectInfo): OpenedProject {
    registerSensitivePath(project.path)
    let handle = this.handlesByPath.get(project.path)
    if (!handle) {
      handle = randomUUID()
      this.handlesByPath.set(project.path, handle)
      this.pathsByHandle.set(handle, project.path)
    }

    return { ...project, handle }
  }

  resolve(input: unknown): string {
    const handle = typeof input === 'string' ? input.trim() : ''
    if (
      !handle ||
      handle.length > MAX_PROJECT_HANDLE_LENGTH ||
      handle.includes('\0')
    ) {
      throw new Error('项目授权无效')
    }

    const projectPath = this.pathsByHandle.get(handle)
    if (!projectPath) throw new Error('项目授权已失效，请重新打开项目')
    return projectPath
  }

  handleForPath(projectPath: string): string | null {
    return this.handlesByPath.get(projectPath) ?? null
  }
}
