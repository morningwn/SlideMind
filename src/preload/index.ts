import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentActivityEvent,
  AgentApi,
  AgentConversationInput,
  AgentPromptInput,
  AgentStopInput,
  AgentStreamEvent,
  AgentTodosEvent,
  SaveAgentConfigInput
} from '../shared/agent'
import type {
  ProjectApi,
  ProjectConversationState,
  ProjectExternalWatchScope,
  ProjectFileChangedEvent,
  RenameProjectDirectoryInput,
  RenameProjectFileInput,
  SaveProjectTextFileInput
} from '../shared/project'
import type {
  CreateProjectPresentationInput,
  ExportProjectPresentationInput,
  ImportProjectPresentationInput,
  PresentationApi,
  PresentationChangedEvent,
  SaveProjectPresentationInput
} from '../shared/presentation'
import type {
  CompareProjectVersionFileInput,
  ProjectVersionApi,
  ProjectVersionCreatedEvent,
  RestoreProjectVersionInput
} from '../shared/project-version'
import type { DesktopApi, DesktopCloseResponse } from '../shared/desktop'
import type { RendererDiagnosticEvent } from '../shared/logging'
import type { DocumentExportApi, ExportMarkdownWordInput } from '../shared/document-export'
import type { ExportMarkdownPdfInput, ExportPresentationPdfInput } from '../shared/pdf-export'

const desktopApi: Readonly<DesktopApi> = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }),
  clearLogs: () => ipcRenderer.invoke('logging:clear'),
  exportDiagnosticBundle: () => ipcRenderer.invoke('logging:export-diagnostics'),
  openCrashReportDirectory: () => ipcRenderer.invoke('logging:open-crash-directory'),
  openLogDirectory: () => ipcRenderer.invoke('logging:open-directory'),
  reportDiagnosticEvent: (event: RendererDiagnosticEvent) => {
    ipcRenderer.send('logging:renderer-event', event)
  },
  onCloseRequested: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('desktop:close-requested', handler)
    return () => ipcRenderer.removeListener('desktop:close-requested', handler)
  },
  resolveCloseRequest: (response: DesktopCloseResponse) =>
    ipcRenderer.invoke('desktop:resolve-close-request', response)
})

contextBridge.exposeInMainWorld('desktop', desktopApi)

const agentApi: Readonly<AgentApi> = Object.freeze({
  getConfig: () => ipcRenderer.invoke('agent:get-config'),
  saveConfig: (input: SaveAgentConfigInput) => ipcRenderer.invoke('agent:save-config', input),
  listSkills: (projectHandle: string) => ipcRenderer.invoke('agent:list-skills', projectHandle),
  getTodos: (input: AgentConversationInput) => ipcRenderer.invoke('agent:get-todos', input),
  getUsage: (input: AgentConversationInput) => ipcRenderer.invoke('agent:get-usage', input),
  prompt: (input: AgentPromptInput) => ipcRenderer.invoke('agent:prompt', input),
  stop: (input: AgentStopInput) => ipcRenderer.invoke('agent:stop', input),
  onStream: (listener: (event: AgentStreamEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, streamEvent: AgentStreamEvent): void => {
      listener(streamEvent)
    }
    ipcRenderer.on('agent:stream', handler)
    return () => ipcRenderer.removeListener('agent:stream', handler)
  },
  onTodos: (listener: (event: AgentTodosEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, todosEvent: AgentTodosEvent): void => {
      listener(todosEvent)
    }
    ipcRenderer.on('agent:todos', handler)
    return () => ipcRenderer.removeListener('agent:todos', handler)
  },
  onActivity: (listener: (event: AgentActivityEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activityEvent: AgentActivityEvent): void => {
      listener(activityEvent)
    }
    ipcRenderer.on('agent:activity', handler)
    return () => ipcRenderer.removeListener('agent:activity', handler)
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
  listFiles: (projectHandle: string) => ipcRenderer.invoke('project:list-files', projectHandle),
  createDirectory: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('project:create-directory', projectHandle, relativePath),
  createMarkdownFile: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('project:create-markdown-file', projectHandle, relativePath),
  renameFile: (projectHandle: string, input: RenameProjectFileInput) =>
    ipcRenderer.invoke('project:rename-file', projectHandle, input),
  deleteFile: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('project:delete-file', projectHandle, relativePath),
  renameDirectory: (projectHandle: string, input: RenameProjectDirectoryInput) =>
    ipcRenderer.invoke('project:rename-directory', projectHandle, input),
  deleteDirectory: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('project:delete-directory', projectHandle, relativePath),
  readTextFile: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('project:read-text-file', projectHandle, relativePath),
  readImageFile: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('project:read-image-file', projectHandle, relativePath),
  readPreviewAsset: (projectHandle: string, documentPath: string, assetPath: string) =>
    ipcRenderer.invoke('project:read-preview-asset', projectHandle, documentPath, assetPath),
  saveTextFile: (projectHandle: string, input: SaveProjectTextFileInput) =>
    ipcRenderer.invoke('project:save-text-file', projectHandle, input),
  watchExternalChanges: (projectHandle: string, scope: ProjectExternalWatchScope) =>
    ipcRenderer.invoke('project:watch-external-changes', projectHandle, scope),
  onFileChanged: (listener: (event: ProjectFileChangedEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      changedEvent: ProjectFileChangedEvent
    ): void => listener(changedEvent)
    ipcRenderer.on('project:file-changed', handler)
    return () => ipcRenderer.removeListener('project:file-changed', handler)
  },
  loadConversations: (projectHandle: string) =>
    ipcRenderer.invoke('project:load-conversations', projectHandle),
  loadConversationMessages: (projectHandle: string, conversationId: string) =>
    ipcRenderer.invoke('project:load-conversation-messages', projectHandle, conversationId),
  saveConversations: (projectHandle: string, state: ProjectConversationState) =>
    ipcRenderer.invoke('project:save-conversations', projectHandle, state)
})

contextBridge.exposeInMainWorld('projects', projectApi)

const projectVersionApi: Readonly<ProjectVersionApi> = Object.freeze({
  list: (projectHandle: string, cursor?: string) =>
    ipcRenderer.invoke('project-version:list', projectHandle, cursor),
  compareFile: (projectHandle: string, input: CompareProjectVersionFileInput) =>
    ipcRenderer.invoke('project-version:compare-file', projectHandle, input),
  restore: (projectHandle: string, input: RestoreProjectVersionInput) =>
    ipcRenderer.invoke('project-version:restore', projectHandle, input),
  onCreated: (listener: (event: ProjectVersionCreatedEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      createdEvent: ProjectVersionCreatedEvent
    ): void => listener(createdEvent)
    ipcRenderer.on('project-version:created', handler)
    return () => ipcRenderer.removeListener('project-version:created', handler)
  }
})

contextBridge.exposeInMainWorld('projectVersions', projectVersionApi)

const presentationApi: Readonly<PresentationApi> = Object.freeze({
  create: (projectHandle: string, input: CreateProjectPresentationInput) =>
    ipcRenderer.invoke('presentation:create', projectHandle, input),
  import: (projectHandle: string, input: ImportProjectPresentationInput) =>
    ipcRenderer.invoke('presentation:import', projectHandle, input),
  read: (projectHandle: string, relativePath: string) =>
    ipcRenderer.invoke('presentation:read', projectHandle, relativePath),
  save: (projectHandle: string, input: SaveProjectPresentationInput) =>
    ipcRenderer.invoke('presentation:save', projectHandle, input),
  export: (projectHandle: string, input: ExportProjectPresentationInput) =>
    ipcRenderer.invoke('presentation:export', projectHandle, input),
  exportPdf: (projectHandle: string, input: ExportPresentationPdfInput) =>
    ipcRenderer.invoke('pdf-export:presentation', projectHandle, input),
  onChanged: (listener: (event: PresentationChangedEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      changedEvent: PresentationChangedEvent
    ): void => listener(changedEvent)
    ipcRenderer.on('presentation:changed', handler)
    return () => ipcRenderer.removeListener('presentation:changed', handler)
  }
})

contextBridge.exposeInMainWorld('presentations', presentationApi)

const documentExportApi: Readonly<DocumentExportApi> = Object.freeze({
  exportWord: (projectHandle: string, input: ExportMarkdownWordInput) =>
    ipcRenderer.invoke('document-export:word', projectHandle, input),
  exportPdf: (projectHandle: string, input: ExportMarkdownPdfInput) =>
    ipcRenderer.invoke('pdf-export:markdown', projectHandle, input)
})

contextBridge.exposeInMainWorld('documentExport', documentExportApi)
