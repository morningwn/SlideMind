import type { AgentPromptReference } from '../../../shared/agent'

export interface ComposerReferenceTrigger {
  type: AgentPromptReference['type']
  query: string
  start: number
  end: number
}

export function findComposerReferenceTrigger(
  value: string,
  selectionStart: number | null,
): ComposerReferenceTrigger | null {
  if (selectionStart === null) return null
  const beforeCaret = value.slice(0, selectionStart)
  const match = /(^|\s)([@/])([^\s@]*)$/.exec(beforeCaret)
  if (!match) return null
  if (match[2] === '/' && match[3].includes('/')) return null

  return {
    type: match[2] === '@' ? 'file' : 'skill',
    query: match[3].trim(),
    start: match.index + match[1].length,
    end: selectionStart,
  }
}

export function insertComposerReference(
  value: string,
  trigger: ComposerReferenceTrigger,
  reference: AgentPromptReference,
): { value: string; caret: number } {
  const label = `${promptReferenceLabel(reference)} `
  return {
    value: `${value.slice(0, trigger.start)}${label}${value.slice(trigger.end)}`,
    caret: trigger.start + label.length,
  }
}

export function promptReferenceLabel(reference: AgentPromptReference): string {
  return reference.type === 'file' ? `@${reference.path}` : `/${reference.name}`
}

export function promptReferenceKey(reference: AgentPromptReference): string {
  return reference.type === 'file'
    ? `file:${reference.path}`
    : `skill:${reference.name}`
}

// Keep references in textual order, including after cut/paste or undo.
export function collectComposerReferences(
  value: string,
  references: AgentPromptReference[],
): AgentPromptReference[] {
  return references
    .map((reference) => {
      const label = promptReferenceLabel(reference)
      let index = value.indexOf(label)
      while (index !== -1) {
        const before = value.slice(0, index)
        const after = value.slice(index + label.length)
        if (
          (!before || /\s$/.test(before)) &&
          (!after || /^[\s，。；！？,;!?]/.test(after))
        ) {
          return { reference, index }
        }
        index = value.indexOf(label, index + 1)
      }
      return { reference, index: -1 }
    })
    .filter(({ index }) => index !== -1)
    .sort((left, right) => left.index - right.index)
    .map(({ reference }) => reference)
}
