import { BrowserWindow, ipcMain } from 'electron'
import type { ProjectRootRegistry } from '../project/project-root-registry'
import type { PresentationService } from './presentation-service'

function resolveProject(
  projectRoots: ProjectRootRegistry,
  projectHandle: unknown
): { projectHandle: string; projectPath: string } {
  if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
  return {
    projectHandle,
    projectPath: projectRoots.resolve(projectHandle)
  }
}

export function registerPresentationIpc(
  service: PresentationService,
  projectRoots: ProjectRootRegistry
): void {
  service.onChanged((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('presentation:changed', event)
    }
  })

  ipcMain.handle('presentation:create', (_event, projectHandle: unknown, input: unknown) => {
    const project = resolveProject(projectRoots, projectHandle)
    return service.create(project.projectPath, project.projectHandle, input)
  })

  ipcMain.handle('presentation:read', (_event, projectHandle: unknown, path: unknown) => {
    const project = resolveProject(projectRoots, projectHandle)
    return service.read(project.projectPath, path)
  })

  ipcMain.handle('presentation:save', (_event, projectHandle: unknown, input: unknown) => {
    const project = resolveProject(projectRoots, projectHandle)
    return service.save(project.projectPath, project.projectHandle, input)
  })

  ipcMain.handle('presentation:export', (_event, projectHandle: unknown, input: unknown) => {
    const project = resolveProject(projectRoots, projectHandle)
    return service.export(project.projectPath, input)
  })
}
