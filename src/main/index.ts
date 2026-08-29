import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { join } from 'node:path'
import { BaseAgentService } from './agent/base-agent'
import { AgentConfigStore } from './agent/config-store'
import { registerAgentIpc } from './agent/ipc'
import { ProjectConversationStore } from './project/conversation-store'
import { registerProjectIpc } from './project/ipc'
import { RecentProjectStore } from './project/recent-project-store'
import { ProjectRootRegistry } from './project/project-root-registry'
import { getTitleBarWindowOptions } from './window-options'

const APP_URL_PROTOCOLS = new Set(['http:', 'https:'])

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

  mainWindow.once('ready-to-show', () => mainWindow.show())

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
    if (choice === 0) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  const configStore = new AgentConfigStore(join(app.getPath('userData'), 'agent-config.json'))
  const projectRoots = new ProjectRootRegistry()
  const agentService = new BaseAgentService(
    configStore,
    projectRoots,
    join(app.getPath('userData'), 'pi-agent')
  )
  const recentProjectStore = new RecentProjectStore(
    join(app.getPath('userData'), 'recent-projects.json')
  )
  const conversationStore = new ProjectConversationStore()

  registerAgentIpc(configStore, agentService)
  registerProjectIpc(recentProjectStore, conversationStore, projectRoots)
  installApplicationMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
