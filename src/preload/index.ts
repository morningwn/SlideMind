import { contextBridge, ipcRenderer } from 'electron'
import type { AgentApi, SaveAgentConfigInput } from '../shared/agent'
import type { ProjectApi } from '../shared/project'

const desktopApi = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  })
})

contextBridge.exposeInMainWorld('desktop', desktopApi)

const agentApi: Readonly<AgentApi> = Object.freeze({
  getConfig: () => ipcRenderer.invoke('agent:get-config'),
  saveConfig: (input: SaveAgentConfigInput) => ipcRenderer.invoke('agent:save-config', input),
  prompt: (input: string) => ipcRenderer.invoke('agent:prompt', input)
})

contextBridge.exposeInMainWorld('agent', agentApi)

const projectApi: Readonly<ProjectApi> = Object.freeze({
  listRecent: () => ipcRenderer.invoke('project:list-recent'),
  chooseFolder: () => ipcRenderer.invoke('project:choose-folder'),
  open: (path: string) => ipcRenderer.invoke('project:open', path),
  removeRecent: (path: string) => ipcRenderer.invoke('project:remove-recent', path)
})

contextBridge.exposeInMainWorld('projects', projectApi)
