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

export interface ProjectApi {
  listRecent(): Promise<ProjectInfo[]>
  chooseFolder(): Promise<ProjectInfo | null>
  open(path: string): Promise<ProjectInfo>
  removeRecent(path: string): Promise<ProjectInfo[]>
  listDirectory(projectPath: string, relativePath: string): Promise<ProjectFileEntry[]>
}
