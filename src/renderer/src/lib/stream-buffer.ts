import type { AgentStreamEvent } from '../../../shared/agent'

export function createStreamBuffer(
  consume: (events: AgentStreamEvent[]) => void,
) {
  const pending = new Map<string, Map<string, AgentStreamEvent>>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function drain(): AgentStreamEvent[] {
    clearTimeout(timer)
    timer = undefined
    const events = [...pending.values()].flatMap((requests) => [
      ...requests.values(),
    ])
    pending.clear()
    return events
  }

  function flush(): void {
    const events = drain()
    if (events.length) consume(events)
  }

  return {
    push(event: AgentStreamEvent): void {
      let requests = pending.get(event.conversationId)
      if (!requests) {
        requests = new Map()
        pending.set(event.conversationId, requests)
      }
      const previous = requests.get(event.requestId)
      requests.set(event.requestId, {
        ...event,
        delta: (previous?.delta ?? '') + event.delta,
      })
      timer ??= setTimeout(flush, 50)
    },
    flush,
    drain,
  }
}

export function isNearMessageBottom(element: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 80
}

export function applyStreamEvents<
  T extends {
    id: string
    messages: Array<{ id: string; text: string; isStreaming?: boolean }>
  },
>(conversations: T[], events: AgentStreamEvent[]): T[] {
  return conversations.map((conversation) => {
    const deltas = new Map(
      events
        .filter((event) => event.conversationId === conversation.id)
        .map((event) => [event.requestId, event.delta]),
    )
    if (!deltas.size) return conversation
    return {
      ...conversation,
      messages: conversation.messages.map((message) => {
        const delta = deltas.get(message.id)
        return delta && message.isStreaming
          ? { ...message, text: message.text + delta }
          : message
      }),
    }
  })
}
