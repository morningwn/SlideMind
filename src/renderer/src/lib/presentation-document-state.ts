import type { PresentationDocument } from '../../../shared/presentation'

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (value === null || typeof value !== 'object') return value

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key])
  }
  return sorted
}

export function serializePresentationDocumentState(document: PresentationDocument): string {
  return JSON.stringify(sortObjectKeys(document))
}
