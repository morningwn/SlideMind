import { BrowserWindow, dialog, ipcMain } from 'electron'
import type {
  OpenedProject,
  ProjectFileChangedEvent,
  ProjectInfo,
} from '../../shared/project'
import { ProjectConversationStore } from './conversation-store'
import { RecentProjectStore, resolveProject } from './recent-project-store'
import {
  createProjectDirectory,
  createProjectMarkdownFile,
  deleteProjectDirectory,
  deleteProjectFile,
  listProjectDirectory,
  listProjectFiles,
  projectDirectoryDeletePaths,
  projectDirectoryRenamePaths,
  projectFileRenamePaths,
  renameProjectDirectory,
  renameProjectFile,
} from './project-files'
import { ProjectRootRegistry } from './project-root-registry'
import { ProjectTextFileStore } from './project-text-files'
import type { ProjectMutationService } from '../version-control/project-mutation-service'
import type { ExternalChangeMonitor } from './external-change-monitor'

export function registerProjectIpc(
  store: RecentProjectStore,
  conversationStore: ProjectConversationStore,
  projectRoots: ProjectRootRegistry,
  mutations: ProjectMutationService,
  externalChanges: ExternalChangeMonitor,
): void {
  const textFileStore = new ProjectTextFileStore()
  const emitChanged = (event: ProjectFileChangedEvent): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('project:file-changed', event)
    }
  }
  mutations.onChanged(emitChanged)
  externalChanges.onChanged(emitChanged)
  ipcMain.handle('project:list-recent', () => store.list())

  ipcMain.handle(
    'project:choose-folder',
    async (): Promise<OpenedProject | null> => {
      const owner = BrowserWindow.getFocusedWindow()
      const options: Electron.OpenDialogOptions = {
        title: '选择 SlideMind 项目',
        buttonLabel: '打开项目',
        properties: ['openDirectory', 'createDirectory'],
      }
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) return null

      const project = await resolveProject(result.filePaths[0])
      await store.record(project)
      return projectRoots.grant(project)
    },
  )

  ipcMain.handle(
    'project:open',
    async (_event, path: unknown): Promise<OpenedProject> => {
      if (
        typeof path !== 'string' ||
        !path.trim() ||
        path.length > 4096 ||
        path.includes('\0')
      ) {
        throw new Error('项目路径无效')
      }

      const recentProject = (await store.list()).find(
        (project) => project.path === path,
      )
      if (!recentProject) throw new Error('项目未获授权，请重新选择项目文件夹')

      const project = await resolveProject(recentProject.path)
      await store.record(project)
      return projectRoots.grant(project)
    },
  )

  ipcMain.handle(
    'project:remove-recent',
    async (_event, path: unknown): Promise<ProjectInfo[]> => {
      if (
        typeof path !== 'string' ||
        !path.trim() ||
        path.length > 4096 ||
        path.includes('\0')
      ) {
        throw new Error('项目路径无效')
      }

      return store.remove(path)
    },
  )

  ipcMain.handle(
    'project:list-directory',
    (_event, projectHandle: unknown, relativePath: unknown) =>
      listProjectDirectory(projectRoots.resolve(projectHandle), relativePath),
  )

  ipcMain.handle('project:list-files', (_event, projectHandle: unknown) =>
    listProjectFiles(projectRoots.resolve(projectHandle)),
  )

  ipcMain.handle(
    'project:create-directory',
    async (_event, projectHandle: unknown, relativePath: unknown) => {
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      const entry = await createProjectDirectory(
        projectRoots.resolve(projectHandle),
        relativePath,
      )
      emitChanged({
        projectHandle,
        path: entry.path,
        kind: 'add-directory',
        source: 'file-tree',
      })
      return entry
    },
  )

  ipcMain.handle(
    'project:create-markdown-file',
    (_event, projectHandle: unknown, relativePath: unknown) => {
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      const projectPath = projectRoots.resolve(projectHandle)
      if (typeof relativePath !== 'string') throw new Error('新建路径无效')
      return mutations.run(
        {
          projectPath,
          projectHandle,
          paths: [relativePath],
          source: 'file-tree',
        },
        () => createProjectMarkdownFile(projectPath, relativePath),
      )
    },
  )

  ipcMain.handle(
    'project:rename-file',
    (_event, projectHandle: unknown, inputValue: unknown) => {
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      const projectPath = projectRoots.resolve(projectHandle)
      const { input, paths } = projectFileRenamePaths(inputValue)
      return mutations.run(
        { projectPath, projectHandle, paths, source: 'file-tree' },
        () => renameProjectFile(projectPath, input),
      )
    },
  )

  ipcMain.handle(
    'project:delete-file',
    (_event, projectHandle: unknown, relativePath: unknown) => {
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      if (typeof relativePath !== 'string') throw new Error('文件路径无效')
      const projectPath = projectRoots.resolve(projectHandle)
      return mutations.run(
        {
          projectPath,
          projectHandle,
          paths: [relativePath],
          source: 'file-tree',
        },
        () => deleteProjectFile(projectPath, relativePath),
      )
    },
  )

  ipcMain.handle(
    'project:rename-directory',
    async (_event, projectHandle: unknown, inputValue: unknown) => {
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      const projectPath = projectRoots.resolve(projectHandle)
      const { input, paths } = await projectDirectoryRenamePaths(
        projectPath,
        inputValue,
      )
      return mutations.run(
        { projectPath, projectHandle, paths, source: 'file-tree' },
        () => renameProjectDirectory(projectPath, input),
      )
    },
  )

  ipcMain.handle(
    'project:delete-directory',
    async (_event, projectHandle: unknown, relativePath: unknown) => {
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      const projectPath = projectRoots.resolve(projectHandle)
      const prepared = await projectDirectoryDeletePaths(
        projectPath,
        relativePath,
      )
      return mutations.run(
        {
          projectPath,
          projectHandle,
          paths: prepared.paths,
          source: 'file-tree',
        },
        () => deleteProjectDirectory(projectPath, prepared.path),
      )
    },
  )

  ipcMain.handle(
    'project:read-text-file',
    (_event, projectHandle: unknown, relativePath: unknown) =>
      textFileStore.read(projectRoots.resolve(projectHandle), relativePath),
  )

  ipcMain.handle(
    'project:read-image-file',
    (_event, projectHandle: unknown, relativePath: unknown) =>
      textFileStore.readImage(
        projectRoots.resolve(projectHandle),
        relativePath,
      ),
  )

  ipcMain.handle(
    'project:save-text-file',
    (_event, projectHandle: unknown, input: unknown) => {
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      const projectPath = projectRoots.resolve(projectHandle)
      const path =
        input && typeof input === 'object'
          ? (input as { path?: unknown }).path
          : undefined
      if (typeof path !== 'string')
        return textFileStore.save(projectPath, input)
      return mutations.run(
        {
          projectPath,
          projectHandle,
          paths: [path],
          source: 'text-editor',
        },
        () => textFileStore.save(projectPath, input),
        (result) => result.ok,
      )
    },
  )

  ipcMain.handle(
    'project:watch-external-changes',
    (_event, projectHandle: unknown, scope: unknown) => {
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      return externalChanges.setScope(
        projectRoots.resolve(projectHandle),
        projectHandle,
        scope,
      )
    },
  )

  ipcMain.handle(
    'project:read-preview-asset',
    (
      _event,
      projectHandle: unknown,
      documentPath: unknown,
      assetPath: unknown,
    ) =>
      textFileStore.readPreviewAsset(
        projectRoots.resolve(projectHandle),
        documentPath,
        assetPath,
      ),
  )

  ipcMain.handle(
    'project:load-conversations',
    (_event, projectHandle: unknown) =>
      conversationStore.load(projectRoots.resolve(projectHandle)),
  )

  ipcMain.handle(
    'project:load-conversation-messages',
    (_event, projectHandle: unknown, conversationId: unknown) =>
      conversationStore.loadMessages(
        projectRoots.resolve(projectHandle),
        conversationId,
      ),
  )

  ipcMain.handle(
    'project:save-conversations',
    (_event, projectHandle: unknown, state: unknown) =>
      conversationStore.save(projectRoots.resolve(projectHandle), state),
  )
}
