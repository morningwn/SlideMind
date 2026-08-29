import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { OpenedProject, ProjectInfo } from '../../shared/project'
import { ProjectConversationStore } from './conversation-store'
import { RecentProjectStore, resolveProject } from './recent-project-store'
import { listProjectDirectory } from './project-files'
import { ProjectRootRegistry } from './project-root-registry'
import { ProjectTextFileStore } from './project-text-files'

export function registerProjectIpc(
  store: RecentProjectStore,
  conversationStore: ProjectConversationStore,
  projectRoots: ProjectRootRegistry
): void {
  const textFileStore = new ProjectTextFileStore()
  ipcMain.handle('project:list-recent', () => store.list())

  ipcMain.handle('project:choose-folder', async (): Promise<OpenedProject | null> => {
    const owner = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: '选择 SlideMind 项目',
      buttonLabel: '打开项目',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null

    const project = await resolveProject(result.filePaths[0])
    await store.record(project)
    return projectRoots.grant(project)
  })

  ipcMain.handle('project:open', async (_event, path: unknown): Promise<OpenedProject> => {
    if (typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0')) {
      throw new Error('项目路径无效')
    }

    const recentProject = (await store.list()).find((project) => project.path === path)
    if (!recentProject) throw new Error('项目未获授权，请重新选择项目文件夹')

    const project = await resolveProject(recentProject.path)
    await store.record(project)
    return projectRoots.grant(project)
  })

  ipcMain.handle('project:remove-recent', async (_event, path: unknown): Promise<ProjectInfo[]> => {
    if (typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0')) {
      throw new Error('项目路径无效')
    }

    return store.remove(path)
  })

  ipcMain.handle(
    'project:list-directory',
    (_event, projectHandle: unknown, relativePath: unknown) =>
      listProjectDirectory(projectRoots.resolve(projectHandle), relativePath)
  )

  ipcMain.handle(
    'project:read-text-file',
    (_event, projectHandle: unknown, relativePath: unknown) =>
      textFileStore.read(projectRoots.resolve(projectHandle), relativePath)
  )

  ipcMain.handle(
    'project:save-text-file',
    (_event, projectHandle: unknown, input: unknown) =>
      textFileStore.save(projectRoots.resolve(projectHandle), input)
  )

  ipcMain.handle(
    'project:read-preview-asset',
    (
      _event,
      projectHandle: unknown,
      documentPath: unknown,
      assetPath: unknown
    ) => textFileStore.readPreviewAsset(
      projectRoots.resolve(projectHandle),
      documentPath,
      assetPath
    )
  )

  ipcMain.handle(
    'project:load-conversations',
    (_event, projectHandle: unknown) => conversationStore.load(projectRoots.resolve(projectHandle))
  )

  ipcMain.handle(
    'project:load-conversation-messages',
    (_event, projectHandle: unknown, conversationId: unknown) =>
      conversationStore.loadMessages(projectRoots.resolve(projectHandle), conversationId)
  )

  ipcMain.handle(
    'project:save-conversations',
    (_event, projectHandle: unknown, state: unknown) =>
      conversationStore.save(projectRoots.resolve(projectHandle), state)
  )
}
