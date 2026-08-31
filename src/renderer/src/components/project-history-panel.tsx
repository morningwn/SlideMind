import { diffLines } from 'diff'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectMutationSource } from '../../../shared/project'
import type {
  ProjectVersionChange,
  ProjectVersionComparisonTarget,
  ProjectVersionFileComparison,
  ProjectVersionFileContent,
  ProjectVersionSummary
} from '../../../shared/project-version'

interface ProjectHistoryPanelProps {
  projectHandle: string
  onConfirmRestore: (paths: string[]) => boolean
  onRestoreSettled: (paths: string[]) => void
}

interface DiffLine {
  kind: 'added' | 'context' | 'removed'
  marker: '+' | ' ' | '−'
  oldLine: number | null
  newLine: number | null
  text: string
}

const sourceLabels: Record<ProjectMutationSource, string> = {
  agent: 'Agent',
  'file-tree': '文件树',
  import: '导入',
  'presentation-editor': '演示编辑器',
  restore: '版本恢复',
  'text-editor': '文本编辑器'
}

const changeLabels: Record<ProjectVersionChange['kind'], string> = {
  added: '新增',
  modified: '修改',
  removed: '删除'
}

function HistoryIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.5V3.8M4 3.8h2.8" />
      <path d="M4.6 4.4A8.5 8.5 0 1 1 3.5 13" />
      <path d="M12 7.5V12l3.2 2" />
    </svg>
  )
}

function FileChangeIcon({ kind }: { kind: ProjectVersionChange['kind'] }): React.JSX.Element {
  return <span aria-hidden="true">{kind === 'added' ? '+' : kind === 'removed' ? '−' : '•'}</span>
}

function sourceText(sources: ProjectMutationSource[]): string {
  if (sources.length === 0) return '应用内修改'
  return sources.map((source) => sourceLabels[source]).join('、')
}

function versionDay(value: string): string {
  const date = new Date(value)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000)
  if (dayDifference === 0) return '今天'
  if (dayDifference === 1) return '昨天'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(date)
}

function versionTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function versionDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

function previewMessage(content: ProjectVersionFileContent): string | null {
  if (content.status === 'binary') return '这是二进制文件，无法显示文本差异。'
  if (content.status === 'too-large') return '文件超过 1 MiB，未生成文本差异。'
  return null
}

function buildDiff(comparison: ProjectVersionFileComparison | null): DiffLine[] | null {
  if (!comparison) return null
  const unsupported = previewMessage(comparison.before) ?? previewMessage(comparison.after)
  if (unsupported) return null
  const before = comparison.before.status === 'text' ? comparison.before.content : ''
  const after = comparison.after.status === 'text' ? comparison.after.content : ''
  let oldLine = 1
  let newLine = 1
  const rows: DiffLine[] = []

  for (const change of diffLines(before, after)) {
    const lines = change.value.split('\n')
    if (lines.at(-1) === '') lines.pop()
    for (const text of lines) {
      if (change.added) {
        rows.push({ kind: 'added', marker: '+', oldLine: null, newLine, text })
        newLine += 1
      } else if (change.removed) {
        rows.push({ kind: 'removed', marker: '−', oldLine, newLine: null, text })
        oldLine += 1
      } else {
        rows.push({ kind: 'context', marker: ' ', oldLine, newLine, text })
        oldLine += 1
        newLine += 1
      }
    }
  }
  return rows
}

export function ProjectHistoryPanel({
  projectHandle,
  onConfirmRestore,
  onRestoreSettled
}: ProjectHistoryPanelProps): React.JSX.Element {
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set())
  const [comparisonTarget, setComparisonTarget] = useState<ProjectVersionComparisonTarget>('previous')
  const [comparison, setComparison] = useState<ProjectVersionFileComparison | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isComparing, setIsComparing] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selectedVersionIdRef = useRef(selectedVersionId)
  const selectedPathRef = useRef(selectedPath)
  const checkedPathsRef = useRef(checkedPaths)
  selectedVersionIdRef.current = selectedVersionId
  selectedPathRef.current = selectedPath
  checkedPathsRef.current = checkedPaths

  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? null
  const diff = useMemo(() => buildDiff(comparison), [comparison])

  async function loadVersions(cursor?: string): Promise<void> {
    if (cursor) setIsLoadingMore(true)
    else setIsLoading(true)
    setError('')
    try {
      const page = await window.projectVersions.list(projectHandle, cursor)
      setVersions((current) => cursor ? [...current, ...page.versions] : page.versions)
      setNextCursor(page.nextCursor)
      if (!cursor) {
        const nextVersion = page.versions.find(
          (version) => version.id === selectedVersionIdRef.current
        )
          ?? page.versions[0]
          ?? null
        const nextPath = nextVersion?.changes.some(
          (change) => change.path === selectedPathRef.current
        )
          ? selectedPathRef.current
          : nextVersion?.changes[0]?.path ?? null
        const retainedCheckedPaths = new Set(
          nextVersion?.changes
            .map((change) => change.path)
            .filter((path) => checkedPathsRef.current.has(path))
        )
        setSelectedVersionId(nextVersion?.id ?? null)
        setSelectedPath(nextPath)
        setCheckedPaths(
          nextVersion?.id === selectedVersionIdRef.current
            ? retainedCheckedPaths
            : nextPath
              ? new Set([nextPath])
              : new Set()
        )
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取版本历史')
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadVersions()
  }, [projectHandle])

  useEffect(() => window.projectVersions.onCreated((event) => {
    if (event.projectHandle === projectHandle) void loadVersions()
  }), [projectHandle])

  useEffect(() => {
    if (!selectedVersionId || !selectedPath) {
      setComparison(null)
      return
    }
    let active = true
    setIsComparing(true)
    setError('')
    void window.projectVersions.compareFile(projectHandle, {
      versionId: selectedVersionId,
      path: selectedPath,
      target: comparisonTarget
    }).then((result) => {
      if (active) setComparison(result)
    }).catch((comparisonError: unknown) => {
      if (active) {
        setComparison(null)
        setError(comparisonError instanceof Error ? comparisonError.message : '无法比较文件版本')
      }
    }).finally(() => {
      if (active) setIsComparing(false)
    })
    return () => {
      active = false
    }
  }, [comparisonTarget, projectHandle, selectedPath, selectedVersionId])

  function selectVersion(version: ProjectVersionSummary): void {
    setSelectedVersionId(version.id)
    setSelectedPath(version.changes[0]?.path ?? null)
    setCheckedPaths(version.changes[0] ? new Set([version.changes[0].path]) : new Set())
    setComparisonTarget('previous')
    setNotice('')
  }

  function toggleCheckedPath(path: string): void {
    setCheckedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function restoreSelectedFiles(): Promise<void> {
    if (!selectedVersion || checkedPaths.size === 0 || isRestoring) return
    const paths = selectedVersion.changes
      .map((change) => change.path)
      .filter((path) => checkedPaths.has(path))
    if (!onConfirmRestore(paths)) return

    setIsRestoring(true)
    setError('')
    setNotice('')
    try {
      const comparisons = await Promise.all(paths.map((path) =>
        window.projectVersions.compareFile(projectHandle, {
          versionId: selectedVersion.id,
          path,
          target: 'current'
        })
      ))
      const result = await window.projectVersions.restore(projectHandle, {
        versionId: selectedVersion.id,
        files: comparisons.map((item) => ({
          path: item.path,
          currentRevision: item.currentRevision
        }))
      })
      if (!result.ok) {
        setError(`文件已再次变化，未恢复：${result.paths.join('、')}`)
        return
      }
      setNotice(result.restoredPaths.length > 0
        ? `已恢复 ${result.restoredPaths.length} 个文件，版本历史已同步。`
        : '所选文件已经是该版本状态。')
      await loadVersions()
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : '无法恢复所选版本')
    } finally {
      onRestoreSettled(paths)
      setIsRestoring(false)
    }
  }

  let lastDay = ''

  return (
    <section className="project-history" aria-labelledby="project-history-title">
      <aside className="history-timeline">
        <header className="history-timeline-heading">
          <div>
            <span>应用内记录</span>
            <h2 id="project-history-title">版本历史</h2>
          </div>
          <button
            type="button"
            aria-label="刷新版本历史"
            title="刷新版本历史"
            onClick={() => void loadVersions()}
            disabled={isLoading}
          >↻</button>
        </header>

        <div className="history-timeline-scroll">
          {isLoading ? (
            <p className="history-state">正在读取版本…</p>
          ) : error && versions.length === 0 ? (
            <p className="history-state history-state-error" role="alert">{error}</p>
          ) : versions.length === 0 ? (
            <div className="history-empty">
              <HistoryIcon />
              <h3>还没有应用内版本</h3>
              <p>在 SlideMind 内保存文件后，版本会自动出现在这里。</p>
            </div>
          ) : (
            <div className="history-version-list">
              {versions.map((version) => {
                const day = versionDay(version.createdAt)
                const showDay = day !== lastDay
                lastDay = day
                return (
                  <div className="history-version-group" key={version.id}>
                    {showDay ? <h3>{day}</h3> : null}
                    <button
                      className={version.id === selectedVersionId
                        ? 'history-version history-version-active'
                        : 'history-version'}
                      type="button"
                      onClick={() => selectVersion(version)}
                    >
                      <span className="history-version-node" aria-hidden="true" />
                      <span className="history-version-copy">
                        <strong>{versionTime(version.createdAt)}</strong>
                        <span>{sourceText(version.sources)}</span>
                        <small>{version.changes.length} 个文件</small>
                      </span>
                    </button>
                  </div>
                )
              })}
              {nextCursor ? (
                <button
                  className="history-load-more"
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => void loadVersions(nextCursor)}
                >{isLoadingMore ? '正在加载…' : '加载更早版本'}</button>
              ) : null}
            </div>
          )}
        </div>
        <p className="history-scope-note">外部应用的修改会及时刷新，但不会自动记入这里。</p>
      </aside>

      <section className="history-detail">
        {selectedVersion ? (
          <>
            <header className="history-detail-heading">
              <div>
                <span>{sourceText(selectedVersion.sources)}</span>
                <h2>{versionDateTime(selectedVersion.createdAt)}</h2>
                <code>{selectedVersion.id.slice(0, 10)}</code>
              </div>
              <button
                className="history-restore-button"
                type="button"
                disabled={checkedPaths.size === 0 || isRestoring}
                onClick={() => void restoreSelectedFiles()}
              >{isRestoring ? '正在恢复…' : `恢复所选文件${checkedPaths.size ? ` (${checkedPaths.size})` : ''}`}</button>
            </header>

            {error ? <p className="history-feedback history-feedback-error" role="alert">{error}</p> : null}
            {notice ? <p className="history-feedback" role="status">{notice}</p> : null}

            <div className="history-file-strip" aria-label="此版本修改的文件">
              {selectedVersion.changes.map((change) => (
                <div
                  className={change.path === selectedPath
                    ? 'history-file history-file-active'
                    : 'history-file'}
                  key={change.path}
                >
                  <label title={`选择恢复 ${change.path}`}>
                    <input
                      type="checkbox"
                      checked={checkedPaths.has(change.path)}
                      onChange={() => toggleCheckedPath(change.path)}
                    />
                    <span className={`history-file-kind history-file-kind-${change.kind}`}>
                      <FileChangeIcon kind={change.kind} />
                    </span>
                  </label>
                  <button type="button" title={change.path} onClick={() => setSelectedPath(change.path)}>
                    <strong>{fileName(change.path)}</strong>
                    <small>{changeLabels[change.kind]} · {change.path}</small>
                  </button>
                </div>
              ))}
            </div>

            <div className="history-comparison-bar">
              <div className="history-comparison-switch" aria-label="版本比较方式">
                <button
                  className={comparisonTarget === 'previous' ? 'history-comparison-active' : ''}
                  type="button"
                  aria-pressed={comparisonTarget === 'previous'}
                  onClick={() => setComparisonTarget('previous')}
                >本次改动</button>
                <button
                  className={comparisonTarget === 'current' ? 'history-comparison-active' : ''}
                  type="button"
                  aria-pressed={comparisonTarget === 'current'}
                  onClick={() => setComparisonTarget('current')}
                >与当前比较</button>
              </div>
              <span>{selectedPath ?? '请选择文件'}</span>
            </div>

            <div className="history-diff" aria-live="polite">
              {isComparing ? (
                <p className="history-state">正在生成差异…</p>
              ) : !comparison ? (
                <p className="history-state">请选择要查看的文件。</p>
              ) : previewMessage(comparison.before) ?? previewMessage(comparison.after) ? (
                <div className="history-diff-unavailable">
                  <FileChangeIcon kind="modified" />
                  <h3>无法显示文本差异</h3>
                  <p>{previewMessage(comparison.before) ?? previewMessage(comparison.after)}</p>
                  <p>仍可将文件恢复为所选版本状态。</p>
                </div>
              ) : diff?.length ? (
                <div className="history-diff-lines" role="table" aria-label="文件差异">
                  {diff.map((line, index) => (
                    <div className={`history-diff-line history-diff-line-${line.kind}`} role="row" key={`${index}-${line.kind}`}>
                      <span role="cell">{line.oldLine ?? ''}</span>
                      <span role="cell">{line.newLine ?? ''}</span>
                      <span role="cell">{line.marker}</span>
                      <code role="cell">{line.text || ' '}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="history-diff-unavailable">
                  <span aria-hidden="true">✓</span>
                  <h3>没有内容差异</h3>
                  <p>文件当前内容与比较目标一致。</p>
                </div>
              )}
            </div>
          </>
        ) : !isLoading ? (
          <div className="history-detail-empty">
            <HistoryIcon />
            <h2>选择一个版本查看改动</h2>
          </div>
        ) : null}
      </section>
    </section>
  )
}
