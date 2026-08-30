import type { ISlideData } from '@univerjs/slides'

export const PRESENTATION_FILE_SUFFIX = '.slides.json'
export const PRESENTATION_FORMAT = 'slidemind.presentation' as const
export const PRESENTATION_FORMAT_VERSION = 1 as const

export interface PresentationDocument {
  format: typeof PRESENTATION_FORMAT
  version: typeof PRESENTATION_FORMAT_VERSION
  snapshot: ISlideData
}

export interface ProjectPresentationFile {
  path: string
  document: PresentationDocument
  revision: string
}

export interface CreateProjectPresentationInput {
  path: string
  title?: string
}

export interface SaveProjectPresentationInput {
  path: string
  document: PresentationDocument
  revision: string
}

export type SaveProjectPresentationResult =
  | { ok: true; revision: string }
  | { ok: false; reason: 'conflict'; currentRevision: string }

export interface ExportProjectPresentationInput {
  path: string
  outputPath?: string
}

export interface ExportProjectPresentationResult {
  outputPath: string
}

export interface PresentationChangedEvent {
  projectHandle: string
  path: string
}

export interface PresentationApi {
  create(
    projectHandle: string,
    input: CreateProjectPresentationInput
  ): Promise<ProjectPresentationFile>
  read(projectHandle: string, relativePath: string): Promise<ProjectPresentationFile>
  save(
    projectHandle: string,
    input: SaveProjectPresentationInput
  ): Promise<SaveProjectPresentationResult>
  export(
    projectHandle: string,
    input: ExportProjectPresentationInput
  ): Promise<ExportProjectPresentationResult>
  onChanged(listener: (event: PresentationChangedEvent) => void): () => void
}

export function isPresentationPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith(PRESENTATION_FILE_SUFFIX)
}
