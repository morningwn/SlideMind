export interface ProjectInfo {
  name: string
  path: string
  lastOpenedAt: string
}

export interface ProjectFileEntry {
  kind: 'directory' | 'file'
  name: string
  path: string
}

export interface ConversationMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
}

export interface ProjectConversation {
  id: string
  title: string
  messages: ConversationMessage[]
}

export interface ProjectConversationState {
  conversations: ProjectConversation[]
  selectedConversationId: string
}

export interface ProjectApi {
  listRecent(): Promise<ProjectInfo[]>
  chooseFolder(): Promise<ProjectInfo | null>
  open(path: string): Promise<ProjectInfo>
  removeRecent(path: string): Promise<ProjectInfo[]>
  listDirectory(projectPath: string, relativePath: string): Promise<ProjectFileEntry[]>
  loadConversations(projectPath: string): Promise<ProjectConversationState | null>
  saveConversations(projectPath: string, state: ProjectConversationState): Promise<void>
}
