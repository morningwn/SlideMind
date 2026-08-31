export type CloseBehavior = 'close-project' | 'keep-window-open' | 'exit-application'

export function resolveCloseBehavior(
  hasActiveProject: boolean,
  hasUnsavedDocuments: boolean,
  confirmDiscard: () => boolean
): CloseBehavior {
  if (!hasActiveProject) return 'exit-application'
  if (hasUnsavedDocuments && !confirmDiscard()) return 'keep-window-open'
  return 'close-project'
}
