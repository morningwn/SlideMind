import { useEffect, useRef, useState } from 'react'
import type { AgentActivity } from '../../../shared/agent'

interface AgentActivityPanelProps {
  activities: readonly AgentActivity[]
  isStreaming: boolean
}

const toolLabels: Readonly<Record<string, string>> = {
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  grep: '搜索内容',
  find: '查找文件',
  ls: '浏览目录',
  todo: '更新任务',
  document_read: '读取办公文档',
  slides_create: '创建演示文稿',
  slides_read: '读取演示文稿',
  slides_write: '更新演示文稿',
  slides_export: '导出演示文稿',
}

export function activityTitle(activity: AgentActivity): string {
  if (activity.kind === 'thinking') return '思考'
  if (activity.kind === 'skill') return activity.name
  return toolLabels[activity.name] ?? activity.name
}

function activityKindLabel(activity: AgentActivity): string {
  if (activity.kind === 'thinking') return 'THINK'
  if (activity.kind === 'skill') return 'SKILL'
  return 'TOOL'
}

function activityStatusLabel(activity: AgentActivity): string {
  if (activity.status === 'running') return '执行中'
  if (activity.status === 'stopped') return '已终止'
  if (activity.status === 'error') return '失败'
  return '完成'
}

export function AgentActivityPanel({
  activities,
  isStreaming,
}: AgentActivityPanelProps): React.JSX.Element | null {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const wasStreaming = useRef(isStreaming)

  useEffect(() => {
    if (isStreaming && !wasStreaming.current) setIsExpanded(true)
    if (!isStreaming && wasStreaming.current) setIsExpanded(false)
    wasStreaming.current = isStreaming
  }, [isStreaming])

  if (activities.length === 0) return null

  const hasRunningActivity = activities.some(
    (activity) => activity.status === 'running',
  )
  const statusLabel =
    hasRunningActivity || isStreaming ? '正在执行' : '执行过程'

  return (
    <section
      className={`agent-activity-panel${hasRunningActivity ? ' is-running' : ''}`}
    >
      <button
        aria-expanded={isExpanded}
        className="agent-activity-toggle"
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        <span className="agent-activity-pulse" aria-hidden="true" />
        <span>{statusLabel}</span>
        <small>{activities.length} 项</small>
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {isExpanded ? (
        <div className="agent-activity-list">
          {activities.map((activity) => {
            const body = activity.content?.trim() || activity.detail?.trim()
            return (
              <details
                className={`agent-activity-item is-${activity.status}`}
                key={activity.id}
              >
                <summary>
                  <span className={`agent-activity-kind is-${activity.kind}`}>
                    {activityKindLabel(activity)}
                  </span>
                  <strong>{activityTitle(activity)}</strong>
                  <small>{activityStatusLabel(activity)}</small>
                  {body ? (
                    <span
                      className="agent-activity-item-chevron"
                      aria-hidden="true"
                    />
                  ) : null}
                </summary>
                {body ? (
                  activity.kind === 'thinking' ? (
                    <p>{body}</p>
                  ) : (
                    <pre>{body}</pre>
                  )
                ) : null}
              </details>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
