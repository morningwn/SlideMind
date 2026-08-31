import type { AgentPromptReference } from '../../../shared/agent'

export interface ComposerReferenceTrigger {
  type: AgentPromptReference['type']
  query: string
  start: number
  end: number
}

export function findComposerReferenceTrigger(
  value: string,
  selectionStart: number | null
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
    end: selectionStart
  }
}

export function removeComposerReferenceTrigger(
  value: string,
  trigger: ComposerReferenceTrigger
): { value: string; caret: number } {
  return {
    value: `${value.slice(0, trigger.start)}${value.slice(trigger.end)}`,
    caret: trigger.start
  }
}

export function promptReferenceLabel(reference: AgentPromptReference): string {
  return reference.type === 'file' ? `@${reference.path}` : `/${reference.name}`
}

export function promptReferenceKey(reference: AgentPromptReference): string {
  return reference.type === 'file' ? `file:${reference.path}` : `skill:${reference.name}`
}
