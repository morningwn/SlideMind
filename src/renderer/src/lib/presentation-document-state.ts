import type { PresentationDocument } from '../../../shared/presentation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPresentationElement(value: Record<string, unknown>): boolean {
  return typeof value.type === 'string' &&
    typeof value.id === 'string' &&
    typeof value.left === 'number' &&
    typeof value.top === 'number'
}

function derivedDimension(value: Record<string, unknown>): 'height' | 'width' | null {
  if (!isPresentationElement(value)) return null
  if (value.type === 'table') return 'height'
  if (value.type !== 'text' || value.fixedHeight === true) return null
  return value.vertical === true ? 'width' : 'height'
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (!isRecord(value)) return value

  const sorted: Record<string, unknown> = {}
  const ignoredDimension = derivedDimension(value)
  for (const key of Object.keys(value).sort()) {
    if (key !== ignoredDimension) sorted[key] = sortObjectKeys(value[key])
  }
  return sorted
}

export function serializePresentationDocumentState(document: PresentationDocument): string {
  return JSON.stringify(sortObjectKeys(document))
}
