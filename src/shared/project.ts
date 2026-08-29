export interface ProjectInfo {
  name: string
  path: string
  lastOpenedAt: string
}

export interface ProjectApi {
  listRecent(): Promise<ProjectInfo[]>
  chooseFolder(): Promise<ProjectInfo | null>
  open(path: string): Promise<ProjectInfo>
  removeRecent(path: string): Promise<ProjectInfo[]>
}
