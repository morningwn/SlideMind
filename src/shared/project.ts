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

export interface ConversationMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
}

export interface ProjectConversation {
  id: string
  title: string
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
  listDirectory(projectHandle: string, relativePath: string): Promise<ProjectFileEntry[]>
  loadConversations(projectHandle: string): Promise<ProjectConversationState | null>
  loadConversationMessages(
    projectHandle: string,
    conversationId: string
  ): Promise<ConversationMessage[]>
  saveConversations(projectHandle: string, state: ProjectConversationState): Promise<void>
}
