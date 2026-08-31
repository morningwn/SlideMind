import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { BaseAgentService } from './agent/base-agent'
import { resolveBundledSkillsDirectory } from './agent/bundled-skills'
import { AgentConfigStore } from './agent/config-store'
import { registerAgentIpc } from './agent/ipc'
import { ProjectConversationStore } from './project/conversation-store'
import { ExternalChangeMonitor } from './project/external-change-monitor'
import { registerProjectIpc } from './project/ipc'
import { RecentProjectStore } from './project/recent-project-store'
import { ProjectRootRegistry } from './project/project-root-registry'
import { registerPresentationIpc } from './presentation/ipc'
import { PresentationService } from './presentation/presentation-service'
import { registerProjectVersionIpc } from './version-control/ipc'
import { ProjectMutationService } from './version-control/project-mutation-service'
import { ProjectVersionService } from './version-control/project-version-service'
import { getTitleBarWindowOptions } from './window-options'
import type { DesktopCloseResponse } from '../shared/desktop'
import { registerLoggingIpc } from './logging/ipc'
import {
  initializeLocalCrashReporting,
  reportExistingCrashReports
} from './logging/crash-reporter'
import {
  installApplicationLifecycleLogging,
  installProcessErrorLogging,
  installWindowLifecycleLogging
} from './logging/lifecycle'
import { getLogger, initializeApplicationLogging } from './logging/logger'

const APP_URL_PROTOCOLS = new Set(['http:', 'https:'])
const applicationStartedAt = Date.now()
const pendingWindowCloseRequests = new Set<number>()
let isApplicationQuitting = false

initializeApplicationLogging({
  isPackaged: app.isPackaged,
  logsDirectory: app.getPath('logs')
})
initializeLocalCrashReporting(app.getName())
installProcessErrorLogging()
installApplicationLifecycleLogging(app)
const logger = getLogger('application')

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return APP_URL_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

function installApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerDesktopIpc(): void {
  ipcMain.handle(
    'desktop:resolve-close-request',
    async (event, response: unknown): Promise<boolean> => {
      if (response !== 'keep-window-open' && response !== 'exit-application') {
        throw new Error('窗口关闭响应无效')
      }

      const mainWindow = BrowserWindow.fromWebContents(event.sender)
      if (!mainWindow || !pendingWindowCloseRequests.has(mainWindow.id)) return false

      if ((response satisfies DesktopCloseResponse) === 'keep-window-open') {
        pendingWindowCloseRequests.delete(mainWindow.id)
        return false
      }

      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['退出应用', '取消'],
        defaultId: 1,
        cancelId: 1,
        title: '退出 SlideMind？',
        message: '确定退出 SlideMind 吗？'
      })
      if (choice.response !== 0) {
        pendingWindowCloseRequests.delete(mainWindow.id)
        return false
      }

      pendingWindowCloseRequests.delete(mainWindow.id)
      isApplicationQuitting = true
      app.quit()
      return true
    }
  )
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'SlideMind',
    backgroundColor: '#f3f6fb',
    icon: join(__dirname, '../../assets/icon.png'),
    ...getTitleBarWindowOptions(process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  installWindowLifecycleLogging(mainWindow)

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.on('close', (event) => {
    if (isApplicationQuitting) return

    event.preventDefault()
    if (pendingWindowCloseRequests.has(mainWindow.id)) return

    pendingWindowCloseRequests.add(mainWindow.id)
    mainWindow.webContents.send('desktop:close-requested')
  })

  mainWindow.on('closed', () => {
    pendingWindowCloseRequests.delete(mainWindow.id)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl) {
      event.preventDefault()
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      }
    }
  })

  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['不保存并退出', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '存在未保存的文件',
      message: '部分文件尚未保存。确定放弃修改并退出吗？'
    })
    if (choice === 0) {
      event.preventDefault()
    } else {
      isApplicationQuitting = false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  logger.info('app.started', {
    durationMs: Date.now() - applicationStartedAt,
    context: {
      appVersion: app.getVersion(),
      arch: process.arch,
      electronVersion: process.versions.electron,
      platform: process.platform
    }
  })
  void reportExistingCrashReports(app.getPath('crashDumps'))
  const configStore = new AgentConfigStore(join(app.getPath('userData'), 'agent-config.json'))
  const projectRoots = new ProjectRootRegistry()
  const versionService = new ProjectVersionService()
  const mutationService = new ProjectMutationService(versionService)
  const externalChangeMonitor = new ExternalChangeMonitor(mutationService)
  const presentationService = new PresentationService(mutationService)
  const agentService = new BaseAgentService(
    configStore,
    projectRoots,
    join(app.getPath('userData'), 'pi-agent'),
    resolveBundledSkillsDirectory({
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath
    }),
    presentationService,
    mutationService
  )
  const recentProjectStore = new RecentProjectStore(
    join(app.getPath('userData'), 'recent-projects.json')
  )
  const conversationStore = new ProjectConversationStore()

  registerAgentIpc(configStore, agentService)
  registerDesktopIpc()
  registerLoggingIpc({
    crashDumpsDirectory: app.getPath('crashDumps'),
    downloadsDirectory: app.getPath('downloads'),
    logsDirectory: app.getPath('logs'),
    environment: {
      application: {
        isPackaged: app.isPackaged,
        name: app.getName(),
        version: app.getVersion()
      },
      runtime: {
        arch: process.arch,
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
        platform: process.platform
      }
    }
  })
  registerProjectIpc(
    recentProjectStore,
    conversationStore,
    projectRoots,
    mutationService,
    externalChangeMonitor
  )
  registerPresentationIpc(presentationService, projectRoots)
  registerProjectVersionIpc(projectRoots, versionService, mutationService)
  installApplicationMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('will-quit', () => {
    void versionService.flushAll()
    void externalChangeMonitor.closeAll()
  })
})

app.on('before-quit', () => {
  isApplicationQuitting = true
  logger.info('app.shutdown_requested')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
