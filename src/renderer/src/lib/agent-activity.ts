import type { AgentActivity, AgentActivityEvent } from '../../../shared/agent'

export function applyAgentActivityEvent(
  activities: readonly AgentActivity[],
  event: AgentActivityEvent
): AgentActivity[] {
  if (event.type === 'start') {
    const existingIndex = activities.findIndex((activity) => activity.id === event.activity.id)
    if (existingIndex < 0) return [...activities, event.activity]
    return activities.map((activity, index) => (
      index === existingIndex ? event.activity : activity
    ))
  }

  if (event.type === 'append') {
    const existing = activities.find((activity) => activity.id === event.activityId)
    if (!existing) {
      return [...activities, {
        id: event.activityId,
        kind: 'thinking',
        name: '模型思考',
        status: 'running',
        content: event.delta
      }]
    }
    return activities.map((activity) => (
      activity.id === event.activityId
        ? { ...activity, content: `${activity.content ?? ''}${event.delta}` }
        : activity
    ))
  }

  return activities.map((activity) => {
    if (activity.id !== event.activityId) return activity
    const errorDetail = event.status === 'error' && event.detail
      ? `错误：${event.detail}`
      : undefined
    return {
      ...activity,
      status: event.status,
      detail: [activity.detail, errorDetail].filter(Boolean).join('\n\n') || undefined
    }
  })
}

export function stopRunningAgentActivities(
  activities: readonly AgentActivity[]
): AgentActivity[] {
  return activities.map((activity) => (
    activity.status === 'running' ? { ...activity, status: 'stopped' } : activity
  ))
}
