import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { ProjectRootRegistry } from '../project/project-root-registry'
import {
  defaultPresentationSavePath,
  ensurePptxOutputPath
} from './presentation-export-path'
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

  ipcMain.handle('presentation:export', async (
    _event,
    projectHandle: unknown,
    input: unknown
  ) => {
    const project = resolveProject(projectRoots, projectHandle)
    const path = input && typeof input === 'object'
      ? (input as { path?: unknown }).path
      : undefined
    if (typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0')) {
      throw new Error('演示文稿路径无效')
    }

    const options: Electron.SaveDialogOptions = {
      title: '导出 PowerPoint',
      buttonLabel: '导出',
      defaultPath: defaultPresentationSavePath(app.getPath('desktop'), path),
      filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    }
    const owner = BrowserWindow.fromWebContents(_event.sender) ?? BrowserWindow.getFocusedWindow()
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null

    const outputPath = ensurePptxOutputPath(result.filePath)
    return service.exportToSelectedPath(
      project.projectPath,
      project.projectHandle,
      { path, outputPath }
    )
  })
}
