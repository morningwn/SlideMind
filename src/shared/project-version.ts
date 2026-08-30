import type { ProjectMutationSource } from './project'

export type ProjectVersionChangeKind = 'added' | 'modified' | 'removed'

export interface ProjectVersionChange {
  path: string
  kind: ProjectVersionChangeKind
}

export interface ProjectVersionSummary {
  id: string
  createdAt: string
  sources: ProjectMutationSource[]
  changes: ProjectVersionChange[]
}

export interface ProjectVersionPage {
  versions: ProjectVersionSummary[]
  nextCursor: string | null
}

export type ProjectVersionComparisonTarget = 'current' | 'previous'

export type ProjectVersionFileContent =
  | { status: 'missing' }
  | { status: 'binary'; byteLength: number }
  | { status: 'too-large'; byteLength: number }
  | { status: 'text'; content: string; byteLength: number }

export interface ProjectVersionFileComparison {
  path: string
  before: ProjectVersionFileContent
  after: ProjectVersionFileContent
  currentRevision: string
}

export interface CompareProjectVersionFileInput {
  versionId: string
  path: string
  target: ProjectVersionComparisonTarget
}

export interface RestoreProjectVersionFile {
  path: string
  currentRevision: string
}

export interface RestoreProjectVersionInput {
  versionId: string
  files: RestoreProjectVersionFile[]
}

export type RestoreProjectVersionResult =
  | { ok: true; restoredPaths: string[] }
  | { ok: false; reason: 'conflict'; paths: string[] }

export interface ProjectVersionCreatedEvent {
  projectHandle: string
  versionId: string
}

export interface ProjectVersionApi {
  list(
    projectHandle: string,
    cursor?: string,
  ): Promise<ProjectVersionPage>
  compareFile(
    projectHandle: string,
    input: CompareProjectVersionFileInput,
  ): Promise<ProjectVersionFileComparison>
  restore(
    projectHandle: string,
    input: RestoreProjectVersionInput,
  ): Promise<RestoreProjectVersionResult>
  onCreated(listener: (event: ProjectVersionCreatedEvent) => void): () => void
}
