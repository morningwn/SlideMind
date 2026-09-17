import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Usage } from '@earendil-works/pi-ai'
import type {
  SessionEntry,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import type { AgentConversationUsage } from '../../shared/agent'

type UsageSessionManager = Pick<
  SessionManager,
  'buildSessionContext' | 'getBranch' | 'getEntries'
>

function finiteTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function billedTokens(usage: Usage): number {
  return (
    finiteTokenCount(usage.input) +
    finiteTokenCount(usage.output) +
    finiteTokenCount(usage.cacheRead) +
    finiteTokenCount(usage.cacheWrite)
  )
}

function contextTokens(usage: Usage): number {
  return finiteTokenCount(usage.totalTokens) || billedTokens(usage)
}

function entryUsage(entry: SessionEntry): Usage | undefined {
  if (
    (entry.type === 'compaction' || entry.type === 'branch_summary') &&
    entry.usage
  ) {
    return entry.usage
  }
  if (entry.type !== 'message') return undefined
  const message = entry.message
  if (message.role === 'assistant') return message.usage
  return 'usage' in message ? message.usage : undefined
}

function validAssistantUsage(message: AgentMessage): Usage | undefined {
  if (
    message.role !== 'assistant' ||
    message.stopReason === 'aborted' ||
    message.stopReason === 'error'
  )
    return undefined
  return contextTokens(message.usage) > 0 ? message.usage : undefined
}

function contentLength(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  return content.reduce((total, block) => {
    if (!block || typeof block !== 'object') return total
    const candidate = block as Record<string, unknown>
    if (typeof candidate.text === 'string') return total + candidate.text.length
    if (typeof candidate.thinking === 'string')
      return total + candidate.thinking.length
    if (candidate.type === 'image') return total + 4_800
    if (candidate.type === 'toolCall') {
      const nameLength =
        typeof candidate.name === 'string' ? candidate.name.length : 0
      try {
        return (
          total +
          nameLength +
          (JSON.stringify(candidate.arguments) ?? '').length
        )
      } catch {
        return total + nameLength
      }
    }
    return total
  }, 0)
}

function estimateMessageTokens(message: AgentMessage): number {
  if ('content' in message) return Math.ceil(contentLength(message.content) / 4)
  try {
    return Math.ceil(JSON.stringify(message).length / 4)
  } catch {
    return 0
  }
}

function estimateCurrentContext(messages: AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = validAssistantUsage(messages[index])
    if (!usage) continue
    return (
      contextTokens(usage) +
      messages
        .slice(index + 1)
        .reduce((total, message) => total + estimateMessageTokens(message), 0)
    )
  }
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  )
}

function hasUnknownPostCompactionContext(branch: SessionEntry[]): boolean {
  let compactionIndex = -1
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    if (branch[index].type !== 'compaction') continue
    compactionIndex = index
    break
  }
  if (compactionIndex < 0) return false
  return !branch
    .slice(compactionIndex + 1)
    .some(
      (entry) =>
        entry.type === 'message' && Boolean(validAssistantUsage(entry.message)),
    )
}

export function conversationUsageFromSession(
  sessionManager: UsageSessionManager,
  contextWindow: number | null,
): AgentConversationUsage {
  const totalTokens = sessionManager.getEntries().reduce((total, entry) => {
    const usage = entryUsage(entry)
    return total + (usage ? billedTokens(usage) : 0)
  }, 0)

  if (!contextWindow || contextWindow <= 0) {
    return {
      totalTokens,
      contextTokens: null,
      contextWindow: null,
      contextPercent: null,
    }
  }

  const branch = sessionManager.getBranch()
  if (hasUnknownPostCompactionContext(branch)) {
    return {
      totalTokens,
      contextTokens: null,
      contextWindow,
      contextPercent: null,
    }
  }

  const tokens = estimateCurrentContext(
    sessionManager.buildSessionContext().messages,
  )
  return {
    totalTokens,
    contextTokens: tokens,
    contextWindow,
    contextPercent: (tokens / contextWindow) * 100,
  }
}
