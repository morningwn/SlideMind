import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ProjectInfo } from '../../shared/project'
import { RecentProjectStore, resolveProject } from './recent-project-store'

export function registerProjectIpc(store: RecentProjectStore): void {
  ipcMain.handle('project:list-recent', () => store.list())

  ipcMain.handle('project:choose-folder', async (): Promise<ProjectInfo | null> => {
    const owner = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: '选择 SlideMind 项目',
      buttonLabel: '打开项目',
      properties: ['openDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null

    const project = await resolveProject(result.filePaths[0])
    await store.record(project)
    return project
  })

  ipcMain.handle('project:open', async (_event, path: unknown): Promise<ProjectInfo> => {
    const project = await resolveProject(path)
    await store.record(project)
    return project
  })

  ipcMain.handle('project:remove-recent', async (_event, path: unknown): Promise<ProjectInfo[]> => {
    if (typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0')) {
      throw new Error('项目路径无效')
    }

    return store.remove(path)
  })
}
