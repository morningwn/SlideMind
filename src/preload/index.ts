import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentApi,
  AgentPromptInput,
  AgentStreamEvent,
  SaveAgentConfigInput
} from '../shared/agent'
import type {
  ProjectApi,
  ProjectConversationState,
  SaveProjectTextFileInput
} from '../shared/project'

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
  prompt: (input: AgentPromptInput) => ipcRenderer.invoke('agent:prompt', input),
  onStream: (listener: (event: AgentStreamEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, streamEvent: AgentStreamEvent): void => {
      listener(streamEvent)
    }
    ipcRenderer.on('agent:stream', handler)
    return () => ipcRenderer.removeListener('agent:stream', handler)
  }
})

contextBridge.exposeInMainWorld('agent', agentApi)

const projectApi: Readonly<ProjectApi> = Object.freeze({
  listRecent: () => ipcRenderer.invoke('project:list-recent'),
  chooseFolder: () => ipcRenderer.invoke('project:choose-folder'),
  open: (path: string) => ipcRenderer.invoke('project:open', path),
  removeRecent: (path: string) => ipcRenderer.invoke('project:remove-recent', path),
  listDirectory: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('project:list-directory', projectHandle, relativePath),
  readTextFile: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('project:read-text-file', projectHandle, relativePath),
  readPreviewAsset: (projectHandle: string, documentPath: string, assetPath: string) =>
    ipcRenderer.invoke('project:read-preview-asset', projectHandle, documentPath, assetPath),
  saveTextFile: (projectHandle: string, input: SaveProjectTextFileInput) =>
    ipcRenderer.invoke('project:save-text-file', projectHandle, input),
  loadConversations: (projectHandle: string) =>
    ipcRenderer.invoke('project:load-conversations', projectHandle),
  loadConversationMessages: (projectHandle: string, conversationId: string) =>
    ipcRenderer.invoke('project:load-conversation-messages', projectHandle, conversationId),
  saveConversations: (projectHandle: string, state: ProjectConversationState) =>
    ipcRenderer.invoke('project:save-conversations', projectHandle, state)
})

contextBridge.exposeInMainWorld('projects', projectApi)
