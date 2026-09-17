export interface ProjectInfo {
  name: string
  path: string
  lastOpenedAt: string
}

export interface OpenedProject extends ProjectInfo {
  handle: string
}

export interface ProjectFileEntry {
  kind: 'directory' | 'file'
  name: string
  path: string
}

export type ProjectTextFileKind = 'markdown' | 'text'

export interface ProjectTextFile {
  path: string
  kind: ProjectTextFileKind
  content: string
  revision: string
  lineEnding: 'lf' | 'crlf'
  hasBom: boolean
}

export interface ProjectImageFile {
  path: string
  mimeType: string
  dataUrl: string
  size: number
  revision: string
}

export interface SaveProjectTextFileInput {
  path: string
  content: string
  revision: string
  hasBom: boolean
}

export interface RenameProjectFileInput {
  path: string
  name: string
}

export type RenameProjectDirectoryInput = RenameProjectFileInput

export type ProjectMutationSource =
  | 'agent'
  | 'file-tree'
  | 'import'
  | 'presentation-editor'
  | 'restore'
  | 'text-editor'

export type ProjectFileChangeSource = ProjectMutationSource | 'external'

export type ProjectFileChangeKind =
  | 'add'
  | 'add-directory'
  | 'change'
  | 'remove'
  | 'remove-directory'

export interface ProjectFileChangedEvent {
  projectHandle: string
  path: string
  kind: ProjectFileChangeKind
  source: ProjectFileChangeSource
}

export interface ProjectExternalWatchScope {
  files: string[]
  directories: string[]
}

export type SaveProjectTextFileResult =
  | { ok: true; revision: string }
  | { ok: false; reason: 'conflict'; currentRevision: string }

export interface ConversationMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
  activities?: import('./agent').AgentActivity[]
}

export interface ProjectConversation {
  id: string
  title: string
  archived?: boolean
}

export interface ProjectConversationState {
  conversations: ProjectConversation[]
  selectedConversationId: string
}

export interface ProjectApi {
  listRecent(): Promise<ProjectInfo[]>
  chooseFolder(): Promise<OpenedProject | null>
  open(path: string): Promise<OpenedProject>
  removeRecent(path: string): Promise<ProjectInfo[]>
  listDirectory(
    projectHandle: string,
    relativePath: string,
  ): Promise<ProjectFileEntry[]>
  listFiles(projectHandle: string): Promise<ProjectFileEntry[]>
  createDirectory(
    projectHandle: string,
    relativePath: string,
  ): Promise<ProjectFileEntry>
  createMarkdownFile(
    projectHandle: string,
    relativePath: string,
  ): Promise<ProjectFileEntry>
  renameFile(
    projectHandle: string,
    input: RenameProjectFileInput,
  ): Promise<ProjectFileEntry>
  deleteFile(projectHandle: string, relativePath: string): Promise<void>
  renameDirectory(
    projectHandle: string,
    input: RenameProjectDirectoryInput,
  ): Promise<ProjectFileEntry>
  deleteDirectory(projectHandle: string, relativePath: string): Promise<void>
  readTextFile(
    projectHandle: string,
    relativePath: string,
  ): Promise<ProjectTextFile>
  readImageFile(
    projectHandle: string,
    relativePath: string,
  ): Promise<ProjectImageFile>
  readPreviewAsset(
    projectHandle: string,
    documentPath: string,
    assetPath: string,
  ): Promise<string>
  saveTextFile(
    projectHandle: string,
    input: SaveProjectTextFileInput,
  ): Promise<SaveProjectTextFileResult>
  watchExternalChanges(
    projectHandle: string,
    scope: ProjectExternalWatchScope,
  ): Promise<void>
  onFileChanged(listener: (event: ProjectFileChangedEvent) => void): () => void
  loadConversations(
    projectHandle: string,
  ): Promise<ProjectConversationState | null>
  loadConversationMessages(
    projectHandle: string,
    conversationId: string,
  ): Promise<ConversationMessage[]>
  saveConversations(
    projectHandle: string,
    state: ProjectConversationState,
  ): Promise<void>
}
