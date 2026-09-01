export const PRESENTATION_FILE_SUFFIX = '.slides.json'
export const PRESENTATION_FORMAT = 'slidemind.presentation' as const
export const PRESENTATION_FORMAT_VERSION = 2 as const

export interface PptistElement extends Record<string, unknown> {
  id: string
  type: string
  left: number
  top: number
  width: number
  height?: number
  rotate?: number
}

export interface PptistSlide extends Record<string, unknown> {
  id: string
  elements: PptistElement[]
}

export interface PptistTheme extends Record<string, unknown> {
  backgroundColor: string
  themeColors: string[]
  fontColor: string
  fontName: string
  outline: Record<string, unknown>
  shadow: Record<string, unknown>
}

export interface PptistPresentation extends Record<string, unknown> {
  title: string
  theme: PptistTheme
  slides: PptistSlide[]
  viewportSize: number
  viewportRatio: number
}

export interface PresentationDocument {
  format: typeof PRESENTATION_FORMAT
  version: typeof PRESENTATION_FORMAT_VERSION
  presentation: PptistPresentation
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

export interface ImportProjectPresentationInput {
  path: string
  document: PresentationDocument
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
  import(
    projectHandle: string,
    input: ImportProjectPresentationInput
  ): Promise<ProjectPresentationFile>
  read(projectHandle: string, relativePath: string): Promise<ProjectPresentationFile>
  save(
    projectHandle: string,
    input: SaveProjectPresentationInput
  ): Promise<SaveProjectPresentationResult>
  export(
    projectHandle: string,
    input: ExportProjectPresentationInput
  ): Promise<ExportProjectPresentationResult | null>
  onChanged(listener: (event: PresentationChangedEvent) => void): () => void
}

export function isPresentationPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith(PRESENTATION_FILE_SUFFIX)
}

export function isPptxPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith('.pptx')
}
