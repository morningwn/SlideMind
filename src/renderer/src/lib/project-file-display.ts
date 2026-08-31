import { isPresentationPath } from '../../../shared/presentation'
import type { ProjectFileEntry } from '../../../shared/project'

export type ProjectFileDisplayKind =
  | 'directory'
  | 'presentation'
  | 'markdown'
  | 'text'
  | 'other'

export function projectFileDisplayKind(
  entry: Pick<ProjectFileEntry, 'kind' | 'path'>
): ProjectFileDisplayKind {
  if (entry.kind === 'directory') return 'directory'
  if (isPresentationPath(entry.path)) return 'presentation'

  const normalizedPath = entry.path.toLocaleLowerCase()
  if (normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown')) return 'markdown'
  if (normalizedPath.endsWith('.txt')) return 'text'
  return 'other'
}

export function isOpenableProjectFile(kind: ProjectFileDisplayKind): boolean {
  return kind === 'presentation' || kind === 'markdown' || kind === 'text'
}
