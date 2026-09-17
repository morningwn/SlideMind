import { basename, dirname } from 'node:path'
import type { AgentActivity } from '../../shared/agent'

const MAX_ARGUMENT_DETAIL_LENGTH = 4_000
const MAX_ARGUMENT_STRING_LENGTH = 800
const MAX_ERROR_DETAIL_LENGTH = 600

function truncated(value: string, maximumLength: number): string {
  return value.length <= maximumLength
    ? value
    : `${value.slice(0, maximumLength)}\n…（内容已截断）`
}

function skillName(toolName: string, args: unknown): string | null {
  if (toolName !== 'read' || !args || typeof args !== 'object') return null

  const path = (args as Record<string, unknown>).path
  if (typeof path !== 'string' || basename(path) !== 'SKILL.md') return null

  const name = basename(dirname(path))
  return name && name !== '.' ? name : null
}

export function formatToolArguments(args: unknown): string | undefined {
  if (args === undefined) return undefined

  try {
    const serialized = JSON.stringify(
      args,
      (_key, value: unknown) =>
        typeof value === 'string'
          ? truncated(value, MAX_ARGUMENT_STRING_LENGTH)
          : value,
      2,
    )
    return serialized
      ? truncated(serialized, MAX_ARGUMENT_DETAIL_LENGTH)
      : undefined
  } catch {
    return '参数无法序列化'
  }
}

export function createToolActivity(
  toolCallId: string,
  toolName: string,
  args: unknown,
): AgentActivity {
  const invokedSkill = skillName(toolName, args)
  return {
    id: toolCallId,
    kind: invokedSkill ? 'skill' : 'tool',
    name: invokedSkill ?? toolName,
    status: 'running',
    detail: formatToolArguments(args),
  }
}

export function toolErrorDetail(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const content = (result as Record<string, unknown>).content
  if (!Array.isArray(content)) return undefined

  const detail = content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        Boolean(block) &&
        typeof block === 'object' &&
        (block as Record<string, unknown>).type === 'text' &&
        typeof (block as Record<string, unknown>).text === 'string',
    )
    .map((block) => block.text)
    .join('\n')
    .trim()

  return detail ? truncated(detail, MAX_ERROR_DETAIL_LENGTH) : undefined
}
