import { describe, expect, it } from 'vitest'
import type { AgentActivityEvent } from '../../../shared/agent'
import {
  applyAgentActivityEvent,
  stopRunningAgentActivities,
} from './agent-activity'

const context = {
  requestId: 'request-1',
  conversationId: 'conversation-1',
}

describe('applyAgentActivityEvent', () => {
  it('assembles streamed thinking and marks it complete', () => {
    const start: AgentActivityEvent = {
      ...context,
      type: 'start',
      activity: {
        id: 'thinking-1',
        kind: 'thinking',
        name: '模型思考',
        status: 'running',
        content: '',
      },
    }
    const append: AgentActivityEvent = {
      ...context,
      type: 'append',
      activityId: 'thinking-1',
      delta: '先分析受众。',
    }
    const finish: AgentActivityEvent = {
      ...context,
      type: 'finish',
      activityId: 'thinking-1',
      status: 'completed',
    }

    const started = applyAgentActivityEvent([], start)
    const appended = applyAgentActivityEvent(started, append)
    expect(applyAgentActivityEvent(appended, finish)).toEqual([
      {
        ...start.activity,
        status: 'completed',
        content: '先分析受众。',
      },
    ])
  })

  it('preserves arguments and appends a failed tool result', () => {
    const activities = [
      {
        id: 'tool-1',
        kind: 'tool' as const,
        name: 'read',
        status: 'running' as const,
        detail: '{"path":"missing.md"}',
      },
    ]
    const event: AgentActivityEvent = {
      ...context,
      type: 'finish',
      activityId: 'tool-1',
      status: 'error',
      detail: 'file not found',
    }

    expect(applyAgentActivityEvent(activities, event)[0]).toEqual({
      ...activities[0],
      status: 'error',
      detail: '{"path":"missing.md"}\n\n错误：file not found',
    })
  })
})

describe('stopRunningAgentActivities', () => {
  it('marks only unfinished activities as stopped', () => {
    expect(
      stopRunningAgentActivities([
        {
          id: 'thinking-1',
          kind: 'thinking',
          name: '模型思考',
          status: 'running',
        },
        { id: 'tool-1', kind: 'tool', name: 'read', status: 'completed' },
      ]),
    ).toEqual([
      {
        id: 'thinking-1',
        kind: 'thinking',
        name: '模型思考',
        status: 'stopped',
      },
      { id: 'tool-1', kind: 'tool', name: 'read', status: 'completed' },
    ])
  })
})
