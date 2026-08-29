import { contextBridge, ipcRenderer } from 'electron'
import type { AgentApi, SaveAgentConfigInput } from '../shared/agent'

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
