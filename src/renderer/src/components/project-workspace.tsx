import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  DEFAULT_AGENT_THINKING_LEVEL,
  isAgentThinkingLevel,
  type AgentConversationUsage,
  type AgentPromptReference,
  type AgentSkillOption,
  type AgentThinkingLevel,
  type AgentTodo,
} from '../../../shared/agent'
import {
  isPresentationPath,
  PRESENTATION_FILE_SUFFIX,
} from '../../../shared/presentation'
import type {
  ConversationMessage,
  OpenedProject,
  ProjectFileChangedEvent,
  ProjectFileEntry,
} from '../../../shared/project'
import { WorkspaceResizeHandle } from './workspace-resize-handle'
import { AgentModelSelect } from './agent-model-select'
import { AgentMarkdown } from './agent-markdown'
import { AgentActivityPanel } from './agent-activity-panel'
import { isNearMessageBottom } from '../lib/stream-buffer'
import { useConversationPersistence } from '../hooks/use-conversation-persistence'
import { useAgentEvents } from '../hooks/use-agent-events'
import { stopRunningAgentActivities } from '../lib/agent-activity'
import {
  isOpenableProjectFile,
  projectFileDisplayKind,
  type ProjectFileDisplayKind,
} from '../lib/project-file-display'
import {
  DocumentEditor,
  type MarkdownViewMode,
  type OpenTextDocument,
} from './document-editor'
import type { OpenPresentationDocument } from './presentation-editor'
import { ImagePreview, type OpenImageDocument } from './image-preview'
import { ProjectHistoryPanel } from './project-history-panel'
import { WorkspaceExportMenu } from './workspace-export-menu'
import {
  findComposerReferenceTrigger,
  promptReferenceKey,
  collectComposerReferences,
  insertComposerReference,
  type ComposerReferenceTrigger,
} from '../lib/composer-references'
import { reportDiagnosticEvent } from '../lib/logger'
import { contextUsageTone, formatTokenCount } from '../lib/agent-usage'
import { serializePresentationDocumentState } from '../lib/presentation-document-state'
import { PptxImportFrame, type PptxImportRequest } from './pptx-import-frame'

const PresentationEditor = lazy(async () => {
  const module = await import('./presentation-editor')
  return { default: module.PresentationEditor }
})

const THINKING_LEVEL_STORAGE_KEY = 'slidemind:agent-thinking-level'
const MAX_PPTX_IMPORT_BYTES = 30 * 1024 * 1024

function loadThinkingLevel(): AgentThinkingLevel {
  try {
    const stored = window.localStorage.getItem(THINKING_LEVEL_STORAGE_KEY)
    return isAgentThinkingLevel(stored) ? stored : DEFAULT_AGENT_THINKING_LEVEL
  } catch {
    return DEFAULT_AGENT_THINKING_LEVEL
  }
}

interface ChatMessage extends ConversationMessage {
  isStreaming?: boolean
}

interface Conversation {
  id: string
  title: string
  archived?: boolean
  messages: ChatMessage[]
}

interface ActiveAgentRequest {
  requestId: string
  conversationId: string
}

interface ProjectWorkspaceProps {
  project: OpenedProject
  onDirtyChange: (isDirty: boolean) => void
}

interface ComposerReferenceOption {
  key: string
  reference: AgentPromptReference
  title: string
  description: string
  badge: 'FILE' | 'SKILL'
}

interface FileTreeLevelProps {
  directoryPath: string
  depth: number
  entriesByDirectory: Readonly<Record<string, ProjectFileEntry[]>>
  expandedPaths: ReadonlySet<string>
  loadingPaths: ReadonlySet<string>
  activeFilePath: string | null
  selectedFilePath: string | null
  treeTabStopPath: string | null
  renameRequestedPath: string | null
  onOpenFile: (entry: ProjectFileEntry) => void
  onDeleteFile: (entry: ProjectFileEntry) => void
  onRenameFile: (entry: ProjectFileEntry, name: string) => Promise<boolean>
  onRenameRequestHandled: () => void
  onSelectFile: (path: string) => void
  onToggle: (entry: ProjectFileEntry) => void
}

function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: '新对话',
    messages: [],
  }
}

function parentDirectory(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separatorIndex < 0 ? '' : path.slice(0, separatorIndex)
}

function isPathInside(path: string, directoryPath: string): boolean {
  return (
    path === directoryPath ||
    path.startsWith(`${directoryPath}/`) ||
    path.startsWith(`${directoryPath}\\`)
  )
}

function replacePathDirectory(
  path: string,
  sourcePath: string,
  destinationPath: string,
): string {
  return isPathInside(path, sourcePath)
    ? `${destinationPath}${path.slice(sourcePath.length)}`
    : path
}

function nextAvailableEntryName(
  entries: readonly ProjectFileEntry[],
  stem: string,
  extension = '',
): string {
  const existingNames = new Set(
    entries.map((entry) => entry.name.toLocaleLowerCase()),
  )
  let suffix = 1
  let name = `${stem}${extension}`
  while (existingNames.has(name.toLocaleLowerCase())) {
    suffix += 1
    name = `${stem}-${suffix}${extension}`
  }
  return name
}

function composerReferenceOptions(
  trigger: ComposerReferenceTrigger | null,
  files: readonly ProjectFileEntry[],
  skills: readonly AgentSkillOption[],
  selectedReferences: readonly AgentPromptReference[],
): ComposerReferenceOption[] {
  if (!trigger) return []
  const selectedKeys = new Set(selectedReferences.map(promptReferenceKey))
  const query = trigger.query.toLocaleLowerCase()
  const options: ComposerReferenceOption[] =
    trigger.type === 'file'
      ? files.map((file) => ({
          key: `file:${file.path}`,
          reference: { type: 'file', path: file.path },
          title: file.name,
          description: file.path,
          badge: 'FILE',
        }))
      : skills.map((skill) => ({
          key: `skill:${skill.name}`,
          reference: { type: 'skill', name: skill.name },
          title: skill.name,
          description: skill.description,
          badge: 'SKILL',
        }))

  return options
    .filter((option) => !selectedKeys.has(option.key))
    .filter(
      (option) =>
        !query ||
        option.title.toLocaleLowerCase().includes(query) ||
        option.description.toLocaleLowerCase().includes(query),
    )
    .sort((left, right) => {
      const leftStarts = left.title.toLocaleLowerCase().startsWith(query)
        ? 0
        : 1
      const rightStarts = right.title.toLocaleLowerCase().startsWith(query)
        ? 0
        : 1
      return (
        leftStarts - rightStarts ||
        left.title.localeCompare(right.title, 'zh-CN')
      )
    })
    .slice(0, 8)
}

function editableNameLength(entry: ProjectFileEntry): number {
  if (entry.kind === 'directory') return entry.name.length
  if (isPresentationPath(entry.name)) {
    return entry.name.length - PRESENTATION_FILE_SUFFIX.length
  }
  const markdownSuffix = /\.(?:markdown|md)$/i.exec(entry.name)?.[0]
  return markdownSuffix
    ? entry.name.length - markdownSuffix.length
    : entry.name.length
}

function ConversationIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14v10H9l-4 3z" />
    </svg>
  )
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h6l1.8 2h10.2v9h-18z" />
    </svg>
  )
}

function FileIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
    </svg>
  )
}

function ProjectFileIcon({
  kind,
}: {
  kind: ProjectFileDisplayKind
}): React.JSX.Element {
  if (kind === 'directory') return <FolderIcon />
  if (kind === 'presentation')
    return <span className="file-type-badge">PPT</span>
  if (kind === 'markdown') return <span className="file-type-badge">MD</span>
  if (kind === 'text') return <span className="file-type-badge">TXT</span>
  if (kind === 'image') return <span className="file-type-badge">IMG</span>
  return <FileIcon />
}

function OpenFileIcon({
  kind,
}: {
  kind: ProjectFileDisplayKind
}): React.JSX.Element {
  if (kind === 'presentation') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.5h16v11H4z" />
        <path d="m10 9 4 2.5-4 2.5z" />
        <path d="M9 20h6M12 16.5V20" />
      </svg>
    )
  }
  if (kind === 'image') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.5h16v13H4z" />
        <path d="m6.5 16 3.5-4 2.7 2.7 1.8-2.2 3 3.5M15.8 9h.1" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
    </svg>
  )
}

function openFileActionLabel(
  kind: ProjectFileDisplayKind,
  name: string,
): string {
  if (kind === 'presentation') return `编辑演示文稿 ${name}`
  if (kind === 'markdown') return `编辑 Markdown 文档 ${name}`
  if (kind === 'image') return `预览图片 ${name}`
  return `编辑文本文件 ${name}`
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

function TodoProgress({
  todos,
}: {
  todos: AgentTodo[]
}): React.JSX.Element | null {
  if (todos.length === 0) return null

  const completedCount = todos.filter(
    (todo) => todo.status === 'completed',
  ).length
  const progress = Math.round((completedCount / todos.length) * 100)

  return (
    <section
      className="agent-todos"
      aria-label="Agent 工作清单"
      aria-live="polite"
    >
      <header className="agent-todos-heading">
        <div>
          <span>工作清单</span>
          <strong>
            {completedCount}/{todos.length} 已完成
          </strong>
        </div>
        <div
          className="agent-todos-progress"
          role="progressbar"
          aria-label="任务完成进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <i style={{ width: `${progress}%` }} />
        </div>
      </header>
      <ol className="agent-todo-list">
        {todos.map((todo) => (
          <li className={`agent-todo agent-todo-${todo.status}`} key={todo.id}>
            <span className="agent-todo-marker" aria-hidden="true">
              {todo.status === 'completed'
                ? '✓'
                : todo.status === 'in_progress'
                  ? '●'
                  : ''}
            </span>
            <div>
              <span>{todo.subject}</span>
              {todo.status === 'in_progress' && todo.activeForm ? (
                <small>{todo.activeForm}</small>
              ) : null}
            </div>
            <small>
              {todo.status === 'completed'
                ? '完成'
                : todo.status === 'in_progress'
                  ? '进行中'
                  : '待处理'}
            </small>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ConversationUsageBar({
  isLoading,
  isUpdating,
  usage,
}: {
  isLoading: boolean
  isUpdating: boolean
  usage?: AgentConversationUsage
}): React.JSX.Element {
  const tone = contextUsageTone(usage?.contextPercent ?? null)
  const percent =
    usage?.contextPercent === null || usage?.contextPercent === undefined
      ? null
      : Math.max(0, usage.contextPercent)
  const meterWidth = percent === null ? 0 : Math.min(100, percent)
  const contextLabel =
    usage?.contextTokens !== null &&
    usage?.contextTokens !== undefined &&
    usage.contextWindow
      ? `${formatTokenCount(usage.contextTokens)} / ${formatTokenCount(usage.contextWindow)}`
      : '等待下一次回复'

  return (
    <section
      className={`conversation-usage-bar is-${tone}`}
      aria-label="当前对话用量"
      aria-live="polite"
    >
      <div
        className="conversation-usage-total"
        title="当前对话累计 Token，包含模型输入、输出、缓存和带用量的工具调用"
      >
        <span>累计 Token</span>
        <strong>{usage ? formatTokenCount(usage.totalTokens) : '—'}</strong>
      </div>
      <div
        className="conversation-context-usage"
        title="当前上下文占模型上下文窗口的估算用量"
      >
        <span>上下文</span>
        <strong>{isLoading && !usage ? '正在读取…' : contextLabel}</strong>
        <div
          className="conversation-context-meter"
          role={percent === null ? undefined : 'progressbar'}
          aria-label={percent === null ? undefined : '上下文使用比例'}
          aria-valuemin={percent === null ? undefined : 0}
          aria-valuemax={percent === null ? undefined : 100}
          aria-valuenow={
            percent === null ? undefined : Math.min(100, Math.round(percent))
          }
        >
          <i style={{ width: `${meterWidth}%` }} />
        </div>
        <small>{percent === null ? '—' : `${Math.round(percent)}%`}</small>
      </div>
      {isUpdating ? (
        <span className="conversation-usage-updating">
          <i />
          回复后更新
        </span>
      ) : null}
    </section>
  )
}

function FileTreeLevel({
  directoryPath,
  depth,
  entriesByDirectory,
  expandedPaths,
  loadingPaths,
  activeFilePath,
  selectedFilePath,
  treeTabStopPath,
  renameRequestedPath,
  onOpenFile,
  onDeleteFile,
  onRenameFile,
  onRenameRequestHandled,
  onSelectFile,
  onToggle,
}: FileTreeLevelProps): React.JSX.Element {
  const entries = entriesByDirectory[directoryPath] ?? []
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  useEffect(() => {
    if (!renameRequestedPath) return
    const entry = entries.find(
      (candidate) => candidate.path === renameRequestedPath,
    )
    if (!entry) return
    setRenamingPath(entry.path)
    setRenameDraft(entry.name)
    onRenameRequestHandled()
  }, [entries, onRenameRequestHandled, renameRequestedPath])

  function startRenaming(entry: ProjectFileEntry): void {
    setRenamingPath(entry.path)
    setRenameDraft(entry.name)
  }

  async function submitRename(entry: ProjectFileEntry): Promise<void> {
    const name = renameDraft.trim()
    if (!name || name === entry.name) {
      setRenamingPath(null)
      return
    }
    if (await onRenameFile(entry, name)) setRenamingPath(null)
  }

  return (
    <div
      role={depth === 0 ? 'tree' : 'group'}
      aria-label={depth === 0 ? '项目文件' : undefined}
      onKeyDown={
        depth === 0
          ? (event) => {
              if (
                !(event.target instanceof HTMLButtonElement) ||
                event.target.getAttribute('role') !== 'treeitem'
              )
                return
              const item = event.target
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="treeitem"]',
                ),
              ]
              const index = items.indexOf(item)
              let next: HTMLButtonElement | undefined
              if (event.key === 'ArrowDown')
                next = items[Math.min(items.length - 1, index + 1)]
              else if (event.key === 'ArrowUp')
                next = items[Math.max(0, index - 1)]
              else if (event.key === 'Home') next = items[0]
              else if (event.key === 'End') next = items[items.length - 1]
              else if (event.key === 'ArrowRight') {
                if (item.getAttribute('aria-expanded') === 'false') item.click()
                else if (item.getAttribute('aria-expanded') === 'true') {
                  next =
                    item
                      .closest('.file-tree-branch')
                      ?.querySelector<HTMLButtonElement>(
                        ':scope > [role="group"] [role="treeitem"]',
                      ) ?? undefined
                }
              } else if (event.key === 'ArrowLeft') {
                if (item.getAttribute('aria-expanded') === 'true') item.click()
                else
                  next =
                    item
                      .closest('.file-tree-branch')
                      ?.parentElement?.closest('.file-tree-branch')
                      ?.querySelector<HTMLButtonElement>('[role="treeitem"]') ??
                    undefined
              } else return
              event.preventDefault()
              next?.focus()
            }
          : undefined
      }
    >
      {entries.map((entry) => {
        const isDirectory = entry.kind === 'directory'
        const displayKind = projectFileDisplayKind(entry)
        const isOpenable = isOpenableProjectFile(displayKind)
        const isExpanded = expandedPaths.has(entry.path)
        const isLoading = loadingPaths.has(entry.path)
        const isRenaming = renamingPath === entry.path
        return (
          <div className="file-tree-branch" key={entry.path}>
            <div className="file-tree-row">
              {isRenaming ? (
                <form
                  className={`file-tree-item file-tree-rename-form file-tree-${displayKind}${isDirectory ? ' file-tree-directory' : ''}`}
                  style={{ '--tree-depth': depth } as React.CSSProperties}
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submitRename(entry)
                  }}
                >
                  <span className="tree-chevron" aria-hidden="true" />
                  <span className="tree-entry-icon" aria-hidden="true">
                    <ProjectFileIcon kind={displayKind} />
                  </span>
                  <input
                    value={renameDraft}
                    aria-label={`输入 ${entry.name} 的新名称`}
                    autoFocus
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onFocus={(event) =>
                      event.currentTarget.setSelectionRange(
                        0,
                        editableNameLength(entry),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setRenamingPath(null)
                      }
                    }}
                  />
                  <button type="submit" aria-label="确认重命名" title="确认">
                    ✓
                  </button>
                  <button
                    type="button"
                    aria-label="取消重命名"
                    title="取消"
                    onClick={() => setRenamingPath(null)}
                  >
                    ×
                  </button>
                </form>
              ) : (
                <button
                  className={`file-tree-item file-tree-${displayKind}${isDirectory ? ' file-tree-directory' : ''}${entry.path === selectedFilePath ? ' file-tree-item-selected' : ''}${entry.path === activeFilePath ? ' file-tree-item-active' : ''}`}
                  style={{ '--tree-depth': depth } as React.CSSProperties}
                  type="button"
                  role="treeitem"
                  aria-expanded={isDirectory ? isExpanded : undefined}
                  onClick={() => {
                    if (isDirectory) onToggle(entry)
                    else onSelectFile(entry.path)
                  }}
                  onDoubleClick={() => {
                    if (isOpenable) onOpenFile(entry)
                  }}
                  onKeyDown={(event) => {
                    if (isOpenable && event.key === 'Enter') onOpenFile(entry)
                  }}
                  tabIndex={entry.path === treeTabStopPath ? 0 : -1}
                  aria-selected={entry.path === selectedFilePath}
                  onFocus={() => onSelectFile(entry.path)}
                >
                  <span className="tree-chevron" aria-hidden="true">
                    {isDirectory
                      ? isLoading
                        ? '·'
                        : isExpanded
                          ? '⌄'
                          : '›'
                      : ''}
                  </span>
                  <span className="tree-entry-icon" aria-hidden="true">
                    <ProjectFileIcon kind={displayKind} />
                  </span>
                  <span title={entry.path}>{entry.name}</span>
                </button>
              )}
              {!isRenaming ? (
                <span className="file-tree-actions">
                  {isOpenable ? (
                    <button
                      className={`file-tree-open-action file-tree-open-${displayKind}`}
                      type="button"
                      aria-label={openFileActionLabel(displayKind, entry.name)}
                      title={
                        displayKind === 'presentation'
                          ? '编辑演示文稿'
                          : displayKind === 'image'
                            ? '预览图片'
                            : '编辑文档'
                      }
                      onClick={() => onOpenFile(entry)}
                    >
                      <OpenFileIcon kind={displayKind} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`重命名 ${entry.name}`}
                    title="重命名"
                    onClick={() => startRenaming(entry)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${entry.name}`}
                    title="删除"
                    onClick={() => onDeleteFile(entry)}
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </div>
            {isDirectory && isExpanded ? (
              <FileTreeLevel
                directoryPath={entry.path}
                depth={depth + 1}
                entriesByDirectory={entriesByDirectory}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                activeFilePath={activeFilePath}
                selectedFilePath={selectedFilePath}
                treeTabStopPath={treeTabStopPath}
                renameRequestedPath={renameRequestedPath}
                onOpenFile={onOpenFile}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onRenameRequestHandled={onRenameRequestHandled}
                onSelectFile={onSelectFile}
                onToggle={onToggle}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function ProjectWorkspace({
  project,
  onDirtyChange,
}: ProjectWorkspaceProps): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    createConversation(),
  ])
  const [conversationFilter, setConversationFilter] = useState<
    'active' | 'archived' | 'all'
  >('active')
  const [isConversationFilterOpen, setIsConversationFilterOpen] =
    useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState(
    () => conversations[0].id,
  )
  const [draft, setDraft] = useState('')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(292)
  const [conversationHeight, setConversationHeight] = useState(280)
  const [workspaceSize, setWorkspaceSize] = useState({
    width: 1180,
    height: 714,
  })
  const workspaceRef = useRef<HTMLElement>(null)
  const sidebarMaxWidth = Math.min(420, Math.floor(workspaceSize.width * 0.4))
  const sidebarMaxHeight = Math.max(120, workspaceSize.height - 226)
  const effectiveSidebarWidth = Math.min(sidebarWidth, sidebarMaxWidth)
  const effectiveConversationHeight = Math.min(
    conversationHeight,
    sidebarMaxHeight,
  )
  const [thinkingLevel, setThinkingLevel] =
    useState<AgentThinkingLevel>(loadThinkingLevel)
  const [knownReferences, setKnownReferences] = useState<
    AgentPromptReference[]
  >([])
  const promptReferences = collectComposerReferences(draft, knownReferences)
  const [referenceFiles, setReferenceFiles] = useState<ProjectFileEntry[]>([])
  const [skillOptions, setSkillOptions] = useState<AgentSkillOption[]>([])
  const [referenceTrigger, setReferenceTrigger] =
    useState<ComposerReferenceTrigger | null>(null)
  const [activeReferenceIndex, setActiveReferenceIndex] = useState(0)
  const [isReferenceOptionsLoading, setIsReferenceOptionsLoading] =
    useState(true)
  const [referenceOptionsError, setReferenceOptionsError] = useState('')
  const [activeAgentRequest, setActiveAgentRequest] =
    useState<ActiveAgentRequest | null>(null)
  const [isStopping, setIsStopping] = useState(false)
  const [chatError, setChatError] = useState('')
  const [conversationError, setConversationError] = useState('')
  const [isConversationLoading, setIsConversationLoading] = useState(true)
  const [canPersistConversations, setCanPersistConversations] = useState(false)
  const [loadedConversationIds, setLoadedConversationIds] = useState<
    Set<string>
  >(new Set())
  const [loadingConversationIds, setLoadingConversationIds] = useState<
    Set<string>
  >(new Set())
  const [todosByConversation, setTodosByConversation] = useState<
    Record<string, AgentTodo[]>
  >({})
  const [usageByConversation, setUsageByConversation] = useState<
    Record<string, AgentConversationUsage>
  >({})
  const [loadingUsageIds, setLoadingUsageIds] = useState<Set<string>>(new Set())
  const [usageRevisionByConversation, setUsageRevisionByConversation] =
    useState<Record<string, number>>({})
  const [entriesByDirectory, setEntriesByDirectory] = useState<
    Record<string, ProjectFileEntry[]>
  >({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set(['']))
  const [fileError, setFileError] = useState('')
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [pendingPresentationImport, setPendingPresentationImport] =
    useState<PptxImportRequest | null>(null)
  const [renameRequestedPath, setRenameRequestedPath] = useState<string | null>(
    null,
  )
  const [openDocuments, setOpenDocuments] = useState<OpenTextDocument[]>([])
  const [openPresentations, setOpenPresentations] = useState<
    OpenPresentationDocument[]
  >([])
  const [openImages, setOpenImages] = useState<OpenImageDocument[]>([])
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    null,
  )
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isHistoryActive, setIsHistoryActive] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [openingFilePaths, setOpeningFilePaths] = useState<Set<string>>(
    new Set(),
  )
  const streamBuffer = useAgentEvents(setConversations, setTodosByConversation)
  const lastSavedConversationSnapshotRef = useConversationPersistence({
    projectHandle: project.handle,
    conversations,
    selectedConversationId,
    enabled: canPersistConversations && !isConversationLoading,
    onError: setConversationError,
  })
  const followMessagesRef = useRef(true)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const createMenuRef = useRef<HTMLDivElement>(null)
  const pptxImportInputRef = useRef<HTMLInputElement>(null)
  const openDocumentsRef = useRef<OpenTextDocument[]>([])
  const openPresentationsRef = useRef<OpenPresentationDocument[]>([])
  const exportingPathsRef = useRef(new Set<string>())
  const openImagesRef = useRef<OpenImageDocument[]>([])
  const expandedPathsRef = useRef(expandedPaths)
  const confirmedRestorePathsRef = useRef<Set<string>>(new Set())
  const stoppedRequestIdsRef = useRef<Set<string>>(new Set())

  let treeTabStopPath = selectedFilePath
  if (treeTabStopPath) {
    let directory = parentDirectory(treeTabStopPath)
    if (
      !entriesByDirectory[directory]?.some(
        (entry) => entry.path === treeTabStopPath,
      )
    )
      treeTabStopPath = null
    while (directory) {
      if (!expandedPaths.has(directory)) treeTabStopPath = null
      directory = parentDirectory(directory)
    }
  }
  treeTabStopPath ??= entriesByDirectory['']?.[0]?.path ?? null

  const isSending = activeAgentRequest !== null
  const visibleConversations = conversations.filter(
    (conversation) =>
      conversationFilter === 'all' ||
      Boolean(conversation.archived) === (conversationFilter === 'archived'),
  )

  const selectedConversation =
    conversations.find(
      (conversation) => conversation.id === selectedConversationId,
    ) ?? conversations[0]
  const isSelectedConversationSending =
    activeAgentRequest?.conversationId === selectedConversation.id
  const activeDocument = openDocuments.find(
    (document) => document.path === activeDocumentPath,
  )
  const activePresentation = openPresentations.find(
    (presentation) => presentation.path === activeDocumentPath,
  )
  const activeImage = openImages.find(
    (image) => image.path === activeDocumentPath,
  )
  const activeFile = activeDocument ?? activePresentation ?? activeImage
  const selectedTodos = todosByConversation[selectedConversation.id] ?? []
  const selectedUsage = usageByConversation[selectedConversation.id]
  const selectedUsageRevision =
    usageRevisionByConversation[selectedConversation.id] ?? 0
  const isSelectedConversationLoading = loadingConversationIds.has(
    selectedConversation.id,
  )
  const filteredReferenceOptions = composerReferenceOptions(
    referenceTrigger,
    referenceFiles,
    skillOptions,
    promptReferences,
  )
  const hasDirtyDocuments =
    openDocuments.some(
      (document) => document.content !== document.savedContent,
    ) ||
    openPresentations.some(
      (presentation) =>
        presentation.serializedDocument !==
        presentation.savedSerializedDocument,
    )
  openDocumentsRef.current = openDocuments
  openPresentationsRef.current = openPresentations
  openImagesRef.current = openImages
  expandedPathsRef.current = expandedPaths
  useLayoutEffect(() => {
    const element = workspaceRef.current!
    const observer = new ResizeObserver(() => {
      setWorkspaceSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const textarea = composerTextareaRef.current
    if (!textarea) return
    const resize = (): void => {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(150, Math.max(62, textarea.scrollHeight))}px`
    }
    resize()
    let width = textarea.clientWidth
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return
      width = textarea.clientWidth
      resize()
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [draft, activeFile, isHistoryActive])

  useEffect(() => {
    onDirtyChange(hasDirtyDocuments)
  }, [hasDirtyDocuments, onDirtyChange])

  useEffect(() => {
    try {
      window.localStorage.setItem(THINKING_LEVEL_STORAGE_KEY, thinkingLevel)
    } catch {
      // The selected level still applies to the current app session when storage is unavailable.
    }
  }, [thinkingLevel])

  useEffect(() => {
    function protectUnsavedDocuments(event: BeforeUnloadEvent): void {
      if (!hasDirtyDocuments) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', protectUnsavedDocuments)
    return () =>
      window.removeEventListener('beforeunload', protectUnsavedDocuments)
  }, [hasDirtyDocuments])

  useEffect(() => {
    if (!isCreateMenuOpen) return
    createMenuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus()
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!createMenuRef.current?.contains(event.target as Node))
        setIsCreateMenuOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsCreateMenuOpen(false)
        createMenuRef.current
          ?.querySelector<HTMLButtonElement>('.file-create-trigger')
          ?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isCreateMenuOpen])

  useEffect(() => {
    function openHistoryShortcut(event: globalThis.KeyboardEvent): void {
      const shortcutModifier =
        window.desktop.platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (
        !shortcutModifier ||
        !event.shiftKey ||
        event.key.toLocaleLowerCase() !== 'h'
      )
        return
      event.preventDefault()
      setIsHistoryOpen(true)
      setIsHistoryActive(true)
    }

    window.addEventListener('keydown', openHistoryShortcut)
    return () => window.removeEventListener('keydown', openHistoryShortcut)
  }, [])

  useEffect(() => {
    let active = true
    void window.projects
      .listDirectory(project.handle, '')
      .then((entries) => {
        if (active) setEntriesByDirectory({ '': entries })
      })
      .catch((error: unknown) => {
        if (active)
          setFileError(
            error instanceof Error ? error.message : '无法读取项目文件',
          )
      })
      .finally(() => {
        if (active) setLoadingPaths(new Set())
      })

    return () => {
      active = false
    }
  }, [project.handle])

  useEffect(() => {
    let active = true
    setIsReferenceOptionsLoading(true)
    setReferenceOptionsError('')
    setKnownReferences([])
    setReferenceTrigger(null)

    void Promise.all([
      window.projects.listFiles(project.handle),
      window.agent.listSkills(project.handle),
    ])
      .then(([files, skills]) => {
        if (!active) return
        setReferenceFiles(files)
        setSkillOptions(skills)
      })
      .catch((error: unknown) => {
        if (!active) return
        setReferenceOptionsError(
          error instanceof Error ? error.message : '无法读取文件与 skill 列表',
        )
      })
      .finally(() => {
        if (active) setIsReferenceOptionsLoading(false)
      })

    return () => {
      active = false
    }
  }, [project.handle])

  useEffect(
    () =>
      window.presentations.onChanged((event) => {
        if (event.projectHandle !== project.handle) return
        void window.projects
          .listDirectory(project.handle, '')
          .then((entries) => {
            setEntriesByDirectory((current) => ({ ...current, '': entries }))
          })
          .catch((error: unknown) => {
            setFileError(
              error instanceof Error ? error.message : '无法刷新项目文件',
            )
          })

        void window.presentations
          .read(project.handle, event.path)
          .then((file) => {
            setOpenPresentations((current) =>
              current.map((presentation) => {
                if (presentation.path !== event.path || presentation.isSaving)
                  return presentation
                if (
                  presentation.serializedDocument !==
                  presentation.savedSerializedDocument
                ) {
                  return {
                    ...presentation,
                    conflict: true,
                    error:
                      '演示文稿已被 Agent 或其他进程修改。重新载入会放弃当前未保存内容。',
                  }
                }
                const serializedDocument = serializePresentationDocumentState(
                  file.document,
                )
                return {
                  ...presentation,
                  document: file.document,
                  serializedDocument,
                  savedSerializedDocument: serializedDocument,
                  revision: file.revision,
                  reloadKey: crypto.randomUUID(),
                  conflict: false,
                  error: '',
                }
              }),
            )
          })
          .catch(() => undefined)
      }),
    [project.handle],
  )

  useEffect(() => {
    void window.projects
      .watchExternalChanges(project.handle, { files: [], directories: [''] })
      .catch((error: unknown) => {
        setFileError(
          error instanceof Error ? error.message : '无法监听外部文件修改',
        )
      })
  }, [project.handle])

  useEffect(
    () => () => {
      void window.projects
        .watchExternalChanges(project.handle, {
          files: [],
          directories: [],
        })
        .catch(() => undefined)
    },
    [project.handle],
  )

  useEffect(() => {
    let referenceRefreshTimeout: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = window.projects.onFileChanged((event) => {
      if (event.projectHandle !== project.handle) return
      if (event.kind !== 'change') {
        clearTimeout(referenceRefreshTimeout)
        referenceRefreshTimeout = setTimeout(() => {
          void window.projects
            .listFiles(project.handle)
            .then(setReferenceFiles)
            .catch(() => undefined)
        }, 250)
      }
      void handleProjectFileChanged(event)
    })
    return () => {
      unsubscribe()
      clearTimeout(referenceRefreshTimeout)
    }
  }, [project.handle, expandedPaths])

  useEffect(() => {
    function refreshVisibleProjectFiles(): void {
      for (const directory of ['', ...expandedPaths])
        void refreshDirectory(directory)
      for (const path of [
        ...openDocumentsRef.current.map((document) => document.path),
        ...openPresentationsRef.current.map(
          (presentation) => presentation.path,
        ),
        ...openImagesRef.current.map((image) => image.path),
      ]) {
        void handleProjectFileChanged({
          projectHandle: project.handle,
          path,
          kind: 'change',
          source: 'external',
        })
      }
    }

    window.addEventListener('focus', refreshVisibleProjectFiles)
    return () => window.removeEventListener('focus', refreshVisibleProjectFiles)
  }, [expandedPaths, project.handle])

  useEffect(() => {
    let active = true
    setConversationFilter('active')
    setIsConversationFilterOpen(false)
    setIsConversationLoading(true)
    setCanPersistConversations(false)
    setConversationError('')

    setLoadedConversationIds(new Set())
    setLoadingConversationIds(new Set())
    setTodosByConversation({})
    setUsageByConversation({})
    setLoadingUsageIds(new Set())
    setUsageRevisionByConversation({})

    void (async () => {
      try {
        const storedState = await window.projects.loadConversations(
          project.handle,
        )
        if (!active) return

        if (storedState) {
          const storedConversations = storedState.conversations.map(
            (conversation) => ({
              ...conversation,
              messages: [],
            }),
          )
          setConversations(storedConversations)
          setSelectedConversationId(storedState.selectedConversationId)
          lastSavedConversationSnapshotRef.current = JSON.stringify(storedState)
          setLoadingConversationIds(
            new Set([storedState.selectedConversationId]),
          )

          const messages = await window.projects.loadConversationMessages(
            project.handle,
            storedState.selectedConversationId,
          )
          if (!active) return
          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === storedState.selectedConversationId
                ? { ...conversation, messages }
                : conversation,
            ),
          )
          setLoadedConversationIds(
            new Set([storedState.selectedConversationId]),
          )
          setLoadingConversationIds(new Set())
        } else {
          const conversation = createConversation()
          setConversations([conversation])
          setSelectedConversationId(conversation.id)
          setLoadedConversationIds(new Set([conversation.id]))
          lastSavedConversationSnapshotRef.current = ''
        }
        setCanPersistConversations(true)
      } catch (error) {
        if (!active) return
        setConversationError(
          `${error instanceof Error ? error.message : '无法加载项目会话'}；已停止自动保存以保护原记录`,
        )
      } finally {
        if (active) {
          setLoadingConversationIds(new Set())
          setIsConversationLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [project.handle])

  useLayoutEffect(() => {
    followMessagesRef.current = true
  }, [selectedConversation.id, activeDocumentPath, isHistoryActive])

  useLayoutEffect(() => {
    if (!followMessagesRef.current) return
    messageEndRef.current?.scrollIntoView({
      behavior: 'auto',
      block: 'end',
    })
  }, [
    activeDocumentPath,
    isHistoryActive,
    isSelectedConversationSending,
    selectedConversation.id,
    selectedConversation.messages,
  ])

  useEffect(() => {
    if (
      isConversationLoading ||
      Object.prototype.hasOwnProperty.call(
        todosByConversation,
        selectedConversation.id,
      )
    )
      return

    let active = true
    const conversationId = selectedConversation.id
    void window.agent
      .getTodos({
        projectHandle: project.handle,
        conversationId,
      })
      .then((todos) => {
        if (!active) return
        setTodosByConversation((current) =>
          Object.prototype.hasOwnProperty.call(current, conversationId)
            ? current
            : { ...current, [conversationId]: todos },
        )
      })
      .catch((error: unknown) => {
        reportDiagnosticEvent('warn', 'agent.todos_load_failed', error)
      })

    return () => {
      active = false
    }
  }, [
    isConversationLoading,
    project.handle,
    selectedConversation.id,
    todosByConversation,
  ])

  useEffect(() => {
    if (
      isConversationLoading ||
      isSelectedConversationLoading ||
      isSelectedConversationSending
    )
      return

    let active = true
    const conversationId = selectedConversation.id
    setLoadingUsageIds((current) => new Set(current).add(conversationId))
    void window.agent
      .getUsage({
        projectHandle: project.handle,
        conversationId,
      })
      .then((usage) => {
        if (!active) return
        setUsageByConversation((current) => ({
          ...current,
          [conversationId]: usage,
        }))
      })
      .catch((error: unknown) => {
        reportDiagnosticEvent('warn', 'agent.usage_load_failed', error)
      })
      .finally(() => {
        if (!active) return
        setLoadingUsageIds((current) => {
          const next = new Set(current)
          next.delete(conversationId)
          return next
        })
      })

    return () => {
      active = false
    }
  }, [
    isConversationLoading,
    isSelectedConversationLoading,
    isSelectedConversationSending,
    project.handle,
    selectedConversation.id,
    selectedUsageRevision,
  ])

  function startConversation(): void {
    if (isConversationLoading) return
    setActiveDocumentPath(null)
    setConversationFilter('active')
    const existingDraft = conversations.find(
      (conversation) =>
        !conversation.archived &&
        loadedConversationIds.has(conversation.id) &&
        conversation.messages.length === 0,
    )
    if (existingDraft) {
      setSelectedConversationId(existingDraft.id)
      setDraft('')
      setKnownReferences([])
      setReferenceTrigger(null)
      setChatError('')
      return
    }

    const conversation = createConversation()
    setConversations((current) => [conversation, ...current])
    setSelectedConversationId(conversation.id)
    setLoadedConversationIds((current) => new Set(current).add(conversation.id))
    setChatError('')
    setDraft('')
    setKnownReferences([])
    setReferenceTrigger(null)
  }

  async function selectConversation(conversationId: string): Promise<void> {
    setActiveDocumentPath(null)
    setSelectedConversationId(conversationId)
    setChatError('')
    setKnownReferences([])
    setReferenceTrigger(null)
    if (
      loadedConversationIds.has(conversationId) ||
      loadingConversationIds.has(conversationId)
    ) {
      return
    }

    setLoadingConversationIds((current) => new Set(current).add(conversationId))
    try {
      const messages = await window.projects.loadConversationMessages(
        project.handle,
        conversationId,
      )
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages }
            : conversation,
        ),
      )
      setLoadedConversationIds((current) =>
        new Set(current).add(conversationId),
      )
      setConversationError('')
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : '无法加载 Pi 会话',
      )
    } finally {
      setLoadingConversationIds((current) => {
        const next = new Set(current)
        next.delete(conversationId)
        return next
      })
    }
  }

  async function refreshDirectory(directory: string): Promise<void> {
    try {
      const entries = await window.projects.listDirectory(
        project.handle,
        directory,
      )
      setEntriesByDirectory((current) => ({ ...current, [directory]: entries }))
    } catch (error) {
      if (directory === '' || expandedPaths.has(directory)) {
        setFileError(
          error instanceof Error ? error.message : '无法刷新项目文件',
        )
      }
    }
  }

  async function refreshVisibleFileTree(): Promise<void> {
    await Promise.all([
      ...['', ...expandedPathsRef.current].map(refreshDirectory),
      window.projects
        .listFiles(project.handle)
        .then(setReferenceFiles)
        .catch((error: unknown) => {
          setFileError(
            error instanceof Error ? error.message : '无法刷新项目文件',
          )
        }),
    ])
  }

  async function handleProjectFileChanged(
    event: ProjectFileChangedEvent,
  ): Promise<void> {
    if (
      event.source === 'text-editor' ||
      event.source === 'presentation-editor'
    )
      return
    const directory = parentDirectory(event.path)
    if (directory === '' || expandedPaths.has(directory))
      await refreshDirectory(directory)
    const confirmedRestore =
      event.source === 'restore' &&
      confirmedRestorePathsRef.current.delete(event.path)

    const textDocument = openDocumentsRef.current.find(
      (document) => document.path === event.path,
    )
    const presentation = openPresentationsRef.current.find(
      (candidate) => candidate.path === event.path,
    )
    const image = openImagesRef.current.find(
      (candidate) => candidate.path === event.path,
    )
    if (!textDocument && !presentation && !image) return

    if (event.kind === 'remove' || event.kind === 'remove-directory') {
      if (confirmedRestore) {
        setOpenDocuments((current) =>
          current.filter((document) => document.path !== event.path),
        )
        setOpenPresentations((current) =>
          current.filter((candidate) => candidate.path !== event.path),
        )
        setOpenImages((current) =>
          current.filter((candidate) => candidate.path !== event.path),
        )
        setActiveDocumentPath((current) =>
          current === event.path ? null : current,
        )
        return
      }
      if (textDocument) {
        setOpenDocuments((current) =>
          current.map((document) =>
            document.path === event.path
              ? {
                  ...document,
                  conflict: true,
                  error:
                    '文件已被外部程序删除。当前编辑内容仍保留在 SlideMind 中。',
                }
              : document,
          ),
        )
      }
      if (presentation) {
        setOpenPresentations((current) =>
          current.map((candidate) =>
            candidate.path === event.path
              ? {
                  ...candidate,
                  conflict: true,
                  error:
                    '演示文稿已被外部程序删除。当前编辑内容仍保留在 SlideMind 中。',
                }
              : candidate,
          ),
        )
      }
      if (image) {
        setOpenImages((current) =>
          current.map((candidate) =>
            candidate.path === event.path
              ? { ...candidate, error: '图片已被外部程序删除。' }
              : candidate,
          ),
        )
      }
      return
    }

    if (textDocument) {
      try {
        const file = await window.projects.readTextFile(
          project.handle,
          event.path,
        )
        setOpenDocuments((current) =>
          current.map((document) => {
            if (
              document.path !== event.path ||
              document.revision === file.revision
            )
              return document
            if (
              !confirmedRestore &&
              document.content !== document.savedContent
            ) {
              return {
                ...document,
                conflict: true,
                error:
                  '文件已在 SlideMind 外部修改。重新载入会放弃当前未保存内容。',
              }
            }
            return {
              ...document,
              ...file,
              savedContent: file.content,
              isSaving: false,
              conflict: false,
              error: '',
            }
          }),
        )
      } catch (error) {
        setOpenDocuments((current) =>
          current.map((document) =>
            document.path === event.path
              ? {
                  ...document,
                  conflict: true,
                  error:
                    error instanceof Error
                      ? error.message
                      : '无法读取外部修改后的文件',
                }
              : document,
          ),
        )
      }
      return
    }

    if (presentation) {
      try {
        const file = await window.presentations.read(project.handle, event.path)
        const serializedDocument = serializePresentationDocumentState(
          file.document,
        )
        setOpenPresentations((current) =>
          current.map((candidate) => {
            if (
              candidate.path !== event.path ||
              candidate.revision === file.revision
            )
              return candidate
            if (
              !confirmedRestore &&
              candidate.serializedDocument !== candidate.savedSerializedDocument
            ) {
              return {
                ...candidate,
                conflict: true,
                error:
                  '演示文稿已在 SlideMind 外部修改。重新载入会放弃当前未保存内容。',
              }
            }
            return {
              ...candidate,
              document: file.document,
              serializedDocument,
              savedSerializedDocument: serializedDocument,
              revision: file.revision,
              reloadKey: crypto.randomUUID(),
              isSaving: false,
              conflict: false,
              error: '',
            }
          }),
        )
      } catch (error) {
        setOpenPresentations((current) =>
          current.map((candidate) =>
            candidate.path === event.path
              ? {
                  ...candidate,
                  conflict: true,
                  error:
                    error instanceof Error
                      ? error.message
                      : '无法读取外部修改后的演示文稿',
                }
              : candidate,
          ),
        )
      }
      return
    }

    try {
      const file = await window.projects.readImageFile(
        project.handle,
        event.path,
      )
      setOpenImages((current) =>
        current.map((candidate) =>
          candidate.path === event.path && candidate.revision !== file.revision
            ? { ...candidate, ...file, error: '' }
            : candidate,
        ),
      )
    } catch (error) {
      setOpenImages((current) =>
        current.map((candidate) =>
          candidate.path === event.path
            ? {
                ...candidate,
                error:
                  error instanceof Error
                    ? error.message
                    : '无法读取外部修改后的图片',
              }
            : candidate,
        ),
      )
    }
  }

  async function toggleDirectory(entry: ProjectFileEntry): Promise<void> {
    if (expandedPaths.has(entry.path)) {
      setExpandedPaths((current) => {
        const next = new Set(current)
        next.delete(entry.path)
        return next
      })
      return
    }

    setExpandedPaths((current) => new Set(current).add(entry.path))
    setLoadingPaths((current) => new Set(current).add(entry.path))
    setFileError('')
    try {
      const entries = await window.projects.listDirectory(
        project.handle,
        entry.path,
      )
      setEntriesByDirectory((current) => ({
        ...current,
        [entry.path]: entries,
      }))
    } catch (error) {
      setFileError(error instanceof Error ? error.message : '无法读取项目文件')
      setExpandedPaths((current) => {
        const next = new Set(current)
        next.delete(entry.path)
        return next
      })
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current)
        next.delete(entry.path)
        return next
      })
    }
  }

  async function openFile(entry: ProjectFileEntry): Promise<void> {
    const existingDocument = openDocuments.find(
      (document) => document.path === entry.path,
    )
    if (existingDocument) {
      setIsHistoryActive(false)
      setActiveDocumentPath(existingDocument.path)
      setSelectedFilePath(existingDocument.path)
      return
    }
    const existingPresentation = openPresentations.find(
      (presentation) => presentation.path === entry.path,
    )
    if (existingPresentation) {
      setIsHistoryActive(false)
      setActiveDocumentPath(existingPresentation.path)
      setSelectedFilePath(existingPresentation.path)
      return
    }
    const existingImage = openImages.find((image) => image.path === entry.path)
    if (existingImage) {
      setIsHistoryActive(false)
      setActiveDocumentPath(existingImage.path)
      setSelectedFilePath(existingImage.path)
      return
    }
    if (openingFilePaths.has(entry.path)) return

    setOpeningFilePaths((current) => new Set(current).add(entry.path))
    setSelectedFilePath(entry.path)
    setFileError('')
    try {
      if (isPresentationPath(entry.path)) {
        const file = await window.presentations.read(project.handle, entry.path)
        const serializedDocument = serializePresentationDocumentState(
          file.document,
        )
        const presentation: OpenPresentationDocument = {
          ...file,
          name: entry.name,
          serializedDocument,
          savedSerializedDocument: serializedDocument,
          reloadKey: crypto.randomUUID(),
          isSaving: false,
          isExporting: false,
          conflict: false,
          error: '',
        }
        setOpenPresentations((current) =>
          current.some((candidate) => candidate.path === file.path)
            ? current
            : [...current, presentation],
        )
        setIsHistoryActive(false)
        setActiveDocumentPath(file.path)
        return
      }
      if (projectFileDisplayKind(entry) === 'image') {
        const file = await window.projects.readImageFile(
          project.handle,
          entry.path,
        )
        const image: OpenImageDocument = {
          ...file,
          name: entry.name,
          error: '',
        }
        setOpenImages((current) =>
          current.some((candidate) => candidate.path === file.path)
            ? current
            : [...current, image],
        )
        setIsHistoryActive(false)
        setActiveDocumentPath(file.path)
        return
      }
      const file = await window.projects.readTextFile(
        project.handle,
        entry.path,
      )
      const document: OpenTextDocument = {
        ...file,
        name: entry.name,
        savedContent: file.content,
        isSaving: false,
        isExporting: false,
        conflict: false,
        error: '',
        exportError: '',
        exportWarnings: [],
        viewMode: file.kind === 'markdown' ? 'split' : 'edit',
      }
      setOpenDocuments((current) =>
        current.some((candidate) => candidate.path === file.path)
          ? current
          : [...current, document],
      )
      setIsHistoryActive(false)
      setActiveDocumentPath(file.path)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : '无法打开文件')
    } finally {
      setOpeningFilePaths((current) => {
        const next = new Set(current)
        next.delete(entry.path)
        return next
      })
    }
  }

  async function renameEntry(
    entry: ProjectFileEntry,
    name: string,
  ): Promise<boolean> {
    const matchesEntry = (path: string): boolean =>
      entry.kind === 'directory'
        ? isPathInside(path, entry.path)
        : path === entry.path
    const matchingDocuments = openDocumentsRef.current.filter((document) =>
      matchesEntry(document.path),
    )
    const matchingPresentations = openPresentationsRef.current.filter(
      (presentation) => matchesEntry(presentation.path),
    )
    const matchingImages = openImagesRef.current.filter((image) =>
      matchesEntry(image.path),
    )
    if (
      matchingDocuments.some(
        (document) => document.isSaving || document.conflict,
      ) ||
      matchingPresentations.some(
        (presentation) =>
          presentation.isSaving ||
          presentation.isExporting ||
          presentation.conflict,
      )
    ) {
      setFileError('文件或文件夹正在处理或存在冲突，暂时无法重命名')
      return false
    }
    if (
      matchingDocuments.some(
        (document) => document.content !== document.savedContent,
      ) ||
      matchingPresentations.some(
        (presentation) =>
          presentation.serializedDocument !==
          presentation.savedSerializedDocument,
      )
    ) {
      setFileError(
        entry.kind === 'directory'
          ? '请先保存文件夹内所有文件，再进行重命名'
          : '请先保存文件，再进行重命名',
      )
      return false
    }

    setSelectedFilePath(entry.path)
    setFileError('')
    try {
      const renamed =
        entry.kind === 'directory'
          ? await window.projects.renameDirectory(project.handle, {
              path: entry.path,
              name,
            })
          : await window.projects.renameFile(project.handle, {
              path: entry.path,
              name,
            })
      if (entry.kind === 'directory') {
        setOpenDocuments((current) =>
          current.map((document) =>
            matchesEntry(document.path)
              ? {
                  ...document,
                  path: replacePathDirectory(
                    document.path,
                    entry.path,
                    renamed.path,
                  ),
                  conflict: false,
                  error: '',
                }
              : document,
          ),
        )
        setOpenPresentations((current) =>
          current.map((presentation) =>
            matchesEntry(presentation.path)
              ? {
                  ...presentation,
                  path: replacePathDirectory(
                    presentation.path,
                    entry.path,
                    renamed.path,
                  ),
                  conflict: false,
                  error: '',
                }
              : presentation,
          ),
        )
        setOpenImages((current) =>
          current.map((image) =>
            matchesEntry(image.path)
              ? {
                  ...image,
                  path: replacePathDirectory(
                    image.path,
                    entry.path,
                    renamed.path,
                  ),
                  error: '',
                }
              : image,
          ),
        )
        setActiveDocumentPath((current) =>
          current && matchesEntry(current)
            ? replacePathDirectory(current, entry.path, renamed.path)
            : current,
        )
        setSelectedFilePath((current) =>
          current && matchesEntry(current)
            ? replacePathDirectory(current, entry.path, renamed.path)
            : renamed.path,
        )
        setExpandedPaths(
          (current) =>
            new Set(
              [...current].filter((path) => !isPathInside(path, entry.path)),
            ),
        )
        setLoadingPaths(
          (current) =>
            new Set(
              [...current].filter((path) => !isPathInside(path, entry.path)),
            ),
        )
        setEntriesByDirectory((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([path]) => !isPathInside(path, entry.path),
            ),
          ),
        )
        await refreshDirectory(parentDirectory(entry.path))
        return true
      }

      const openDocument = matchingDocuments[0]
      const openPresentation = matchingPresentations[0]
      const openImage = matchingImages[0]
      const keepsTextDocument =
        Boolean(openDocument) && /\.(?:md|markdown|txt)$/i.test(renamed.path)
      const keepsPresentation =
        Boolean(openPresentation) && isPresentationPath(renamed.path)
      const keepsImage =
        Boolean(openImage) && /\.(?:gif|jpe?g|png|webp)$/i.test(renamed.path)
      setOpenDocuments((current) =>
        keepsTextDocument
          ? current.map((document) =>
              document.path === entry.path
                ? {
                    ...document,
                    path: renamed.path,
                    name: renamed.name,
                    kind: /\.(?:md|markdown)$/i.test(renamed.path)
                      ? 'markdown'
                      : 'text',
                    viewMode: /\.(?:md|markdown)$/i.test(renamed.path)
                      ? document.viewMode
                      : 'edit',
                    conflict: false,
                    error: '',
                  }
                : document,
            )
          : current.filter((document) => document.path !== entry.path),
      )
      setOpenPresentations((current) =>
        keepsPresentation
          ? current.map((presentation) =>
              presentation.path === entry.path
                ? {
                    ...presentation,
                    path: renamed.path,
                    name: renamed.name,
                    conflict: false,
                    error: '',
                  }
                : presentation,
            )
          : current.filter((presentation) => presentation.path !== entry.path),
      )
      setOpenImages((current) =>
        keepsImage
          ? current.map((image) =>
              image.path === entry.path
                ? {
                    ...image,
                    path: renamed.path,
                    name: renamed.name,
                    error: '',
                  }
                : image,
            )
          : current.filter((image) => image.path !== entry.path),
      )
      setActiveDocumentPath((current) =>
        current === entry.path
          ? keepsTextDocument || keepsPresentation || keepsImage
            ? renamed.path
            : null
          : current,
      )
      setSelectedFilePath(renamed.path)
      await refreshDirectory(parentDirectory(entry.path))
      return true
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : '无法重命名文件或文件夹',
      )
      return false
    }
  }

  async function deleteEntry(entry: ProjectFileEntry): Promise<void> {
    const matchesEntry = (path: string): boolean =>
      entry.kind === 'directory'
        ? isPathInside(path, entry.path)
        : path === entry.path
    const matchingDocuments = openDocumentsRef.current.filter((document) =>
      matchesEntry(document.path),
    )
    const matchingPresentations = openPresentationsRef.current.filter(
      (presentation) => matchesEntry(presentation.path),
    )
    if (
      matchingDocuments.some((document) => document.isSaving) ||
      matchingPresentations.some(
        (presentation) => presentation.isSaving || presentation.isExporting,
      )
    ) {
      setFileError('文件或文件夹正在处理，暂时无法删除')
      return
    }
    const hasUnsavedChanges = Boolean(
      matchingDocuments.some(
        (document) => document.content !== document.savedContent,
      ) ||
        matchingPresentations.some(
          (presentation) =>
            presentation.serializedDocument !==
            presentation.savedSerializedDocument,
        ),
    )
    const warning =
      entry.kind === 'directory'
        ? `\n文件夹及其中的全部内容都将被移除。${
            hasUnsavedChanges ? '\n当前未保存内容也会丢失。' : ''
          }`
        : hasUnsavedChanges
          ? '\n当前未保存内容也会丢失。'
          : '\n文件将从当前项目中移除。'
    if (!window.confirm(`确定删除“${entry.name}”吗？${warning}`)) return

    setSelectedFilePath(entry.path)
    setFileError('')
    try {
      if (entry.kind === 'directory') {
        await window.projects.deleteDirectory(project.handle, entry.path)
      } else {
        await window.projects.deleteFile(project.handle, entry.path)
      }
      setOpenDocuments((current) =>
        current.filter((document) => !matchesEntry(document.path)),
      )
      setOpenPresentations((current) =>
        current.filter((presentation) => !matchesEntry(presentation.path)),
      )
      setOpenImages((current) =>
        current.filter((image) => !matchesEntry(image.path)),
      )
      setActiveDocumentPath((current) =>
        current && matchesEntry(current) ? null : current,
      )
      setSelectedFilePath((current) =>
        current && matchesEntry(current) ? null : current,
      )
      if (entry.kind === 'directory') {
        setExpandedPaths(
          (current) =>
            new Set(
              [...current].filter((path) => !isPathInside(path, entry.path)),
            ),
        )
        setLoadingPaths(
          (current) =>
            new Set(
              [...current].filter((path) => !isPathInside(path, entry.path)),
            ),
        )
        setEntriesByDirectory((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([path]) => !isPathInside(path, entry.path),
            ),
          ),
        )
      }
      await refreshDirectory(parentDirectory(entry.path))
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : '无法删除文件或文件夹',
      )
    }
  }

  async function createPresentation(): Promise<void> {
    setIsCreateMenuOpen(false)
    setFileError('')
    try {
      const rootEntries = await window.projects.listDirectory(
        project.handle,
        '',
      )
      setEntriesByDirectory((current) => ({ ...current, '': rootEntries }))
      const fileName = nextAvailableEntryName(
        rootEntries,
        'presentation',
        PRESENTATION_FILE_SUFFIX,
      )
      const path = fileName
      const title = '未命名演示文稿'
      const file = await window.presentations.create(project.handle, {
        path,
        title,
      })
      const serializedDocument = serializePresentationDocumentState(
        file.document,
      )
      const presentation: OpenPresentationDocument = {
        ...file,
        name: fileName,
        serializedDocument,
        savedSerializedDocument: serializedDocument,
        reloadKey: crypto.randomUUID(),
        isSaving: false,
        isExporting: false,
        conflict: false,
        error: '',
      }
      setOpenPresentations((current) => [...current, presentation])
      setIsHistoryActive(false)
      setActiveDocumentPath(file.path)
      setSelectedFilePath(file.path)
      await refreshDirectory('')
      setRenameRequestedPath(file.path)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : '无法新建演示文稿')
    }
  }

  function choosePptxImport(): void {
    setIsCreateMenuOpen(false)
    setFileError('')
    pptxImportInputRef.current?.click()
  }

  async function preparePptxImport(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || pendingPresentationImport) return
    if (!file.name.toLocaleLowerCase().endsWith('.pptx')) {
      setFileError('请选择 .pptx 格式的 PowerPoint 文件')
      return
    }
    if (file.size === 0 || file.size > MAX_PPTX_IMPORT_BYTES) {
      setFileError('PPTX 文件必须大于 0 且不超过 30 MiB')
      return
    }

    setFileError('')
    try {
      const rootEntries = await window.projects.listDirectory(
        project.handle,
        '',
      )
      setEntriesByDirectory((current) => ({ ...current, '': rootEntries }))
      const rawStem = file.name
        .replace(/\.pptx$/i, '')
        .normalize('NFC')
        .trim()
      const safeStem =
        rawStem
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
          .replace(/[. ]+$/g, '')
          .slice(0, 120) || 'presentation'
      const path = nextAvailableEntryName(
        rootEntries,
        safeStem,
        PRESENTATION_FILE_SUFFIX,
      )
      setPendingPresentationImport({
        id: crypto.randomUUID(),
        bytes: await file.arrayBuffer(),
        fileName: file.name,
        path,
        title: safeStem,
      })
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : '无法读取 PPTX 文件',
      )
    }
  }

  async function completePptxImport(
    requestId: string,
    document: OpenPresentationDocument['document'],
  ): Promise<void> {
    const request = pendingPresentationImport
    if (!request || request.id !== requestId) return
    try {
      const file = await window.presentations.import(project.handle, {
        path: request.path,
        document,
      })
      const serializedDocument = serializePresentationDocumentState(
        file.document,
      )
      setOpenPresentations((current) => [
        ...current,
        {
          ...file,
          name: request.path,
          serializedDocument,
          savedSerializedDocument: serializedDocument,
          reloadKey: crypto.randomUUID(),
          isSaving: false,
          isExporting: false,
          conflict: false,
          error: '',
        },
      ])
      setIsHistoryActive(false)
      setActiveDocumentPath(file.path)
      setSelectedFilePath(file.path)
      await refreshDirectory('')
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : '无法保存导入的演示文稿',
      )
    } finally {
      setPendingPresentationImport((current) =>
        current?.id === requestId ? null : current,
      )
    }
  }

  function failPptxImport(requestId: string, message: string): void {
    setPendingPresentationImport((current) =>
      current?.id === requestId ? null : current,
    )
    setFileError(`无法导入 PPTX：${message}`)
  }

  async function createDirectory(): Promise<void> {
    setIsCreateMenuOpen(false)
    setFileError('')
    try {
      const rootEntries = await window.projects.listDirectory(
        project.handle,
        '',
      )
      setEntriesByDirectory((current) => ({ ...current, '': rootEntries }))
      const path = nextAvailableEntryName(rootEntries, 'folder')
      const entry = await window.projects.createDirectory(project.handle, path)
      setExpandedPaths((current) => new Set(current).add(entry.path))
      setEntriesByDirectory((current) => ({ ...current, [entry.path]: [] }))
      setSelectedFilePath(entry.path)
      await refreshDirectory('')
      setRenameRequestedPath(entry.path)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : '无法新建文件夹')
    }
  }

  async function createMarkdownDocument(): Promise<void> {
    setIsCreateMenuOpen(false)
    setFileError('')
    try {
      const rootEntries = await window.projects.listDirectory(
        project.handle,
        '',
      )
      setEntriesByDirectory((current) => ({ ...current, '': rootEntries }))
      const path = nextAvailableEntryName(rootEntries, 'document', '.md')
      const entry = await window.projects.createMarkdownFile(
        project.handle,
        path,
      )
      await refreshDirectory('')
      await openFile(entry)
      setRenameRequestedPath(entry.path)
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : '无法新建 Markdown 文档',
      )
    }
  }

  function updatePresentation(
    path: string,
    document: OpenPresentationDocument['document'],
  ): void {
    const serializedDocument = serializePresentationDocumentState(document)
    setOpenPresentations((current) => {
      const presentationIndex = current.findIndex(
        (presentation) => presentation.path === path,
      )
      const presentation = current[presentationIndex]
      if (
        !presentation ||
        presentation.serializedDocument === serializedDocument
      )
        return current

      const next = [...current]
      next[presentationIndex] = {
        ...presentation,
        document,
        serializedDocument,
        error: '',
        lastExportPath: undefined,
      }
      return next
    })
  }

  async function savePresentation(
    path: string,
    documentOverride?: OpenPresentationDocument['document'],
  ): Promise<boolean> {
    const presentation = openPresentationsRef.current.find(
      (candidate) => candidate.path === path,
    )
    if (!presentation || presentation.isSaving || presentation.conflict)
      return false
    const document = documentOverride ?? presentation.document
    const serializedDocument = serializePresentationDocumentState(document)
    if (serializedDocument === presentation.savedSerializedDocument) return true

    setOpenPresentations((current) =>
      current.map((candidate) =>
        candidate.path === path
          ? { ...candidate, isSaving: true, error: '' }
          : candidate,
      ),
    )
    try {
      const result = await window.presentations.save(project.handle, {
        path,
        revision: presentation.revision,
        document,
      })
      if (!result.ok) {
        setOpenPresentations((current) =>
          current.map((candidate) =>
            candidate.path === path
              ? {
                  ...candidate,
                  isSaving: false,
                  conflict: true,
                  error:
                    '演示文稿已被其他程序修改。重新载入会放弃当前未保存内容。',
                }
              : candidate,
          ),
        )
        return false
      }
      setOpenPresentations((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                isSaving: false,
                revision: result.revision,
                savedSerializedDocument: serializedDocument,
                conflict: false,
                error: '',
              }
            : candidate,
        ),
      )
      return true
    } catch (error) {
      setOpenPresentations((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                isSaving: false,
                error:
                  error instanceof Error ? error.message : '无法保存演示文稿',
              }
            : candidate,
        ),
      )
      return false
    }
  }

  async function reloadPresentation(path: string): Promise<void> {
    const presentation = openPresentations.find(
      (candidate) => candidate.path === path,
    )
    if (!presentation) return
    if (
      presentation.serializedDocument !==
        presentation.savedSerializedDocument &&
      !window.confirm(`重新载入 ${presentation.name}？当前未保存内容将丢失。`)
    )
      return

    try {
      const file = await window.presentations.read(project.handle, path)
      const serializedDocument = serializePresentationDocumentState(
        file.document,
      )
      setOpenPresentations((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                document: file.document,
                serializedDocument,
                savedSerializedDocument: serializedDocument,
                revision: file.revision,
                reloadKey: crypto.randomUUID(),
                isSaving: false,
                conflict: false,
                error: '',
              }
            : candidate,
        ),
      )
    } catch (error) {
      setOpenPresentations((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                error:
                  error instanceof Error
                    ? error.message
                    : '无法重新载入演示文稿',
              }
            : candidate,
        ),
      )
    }
  }

  function closePresentation(path: string): void {
    const presentationIndex = openPresentations.findIndex(
      (presentation) => presentation.path === path,
    )
    const presentation = openPresentations[presentationIndex]
    if (!presentation) return
    if (
      presentation.serializedDocument !==
        presentation.savedSerializedDocument &&
      !window.confirm(`关闭 ${presentation.name}？当前未保存内容将丢失。`)
    )
      return

    const remaining = openPresentations.filter(
      (candidate) => candidate.path !== path,
    )
    setOpenPresentations(remaining)
    if (activeDocumentPath === path) {
      const nextPresentation =
        remaining[Math.min(presentationIndex, remaining.length - 1)]
      setActiveDocumentPath(
        nextPresentation?.path ??
          openDocuments.at(-1)?.path ??
          openImages.at(-1)?.path ??
          null,
      )
    }
  }

  function closeImage(path: string): void {
    const imageIndex = openImages.findIndex((image) => image.path === path)
    if (imageIndex < 0) return
    const remaining = openImages.filter((image) => image.path !== path)
    setOpenImages(remaining)
    if (activeDocumentPath === path) {
      const nextImage = remaining[Math.min(imageIndex, remaining.length - 1)]
      setActiveDocumentPath(
        nextImage?.path ??
          openDocuments.at(-1)?.path ??
          openPresentations.at(-1)?.path ??
          null,
      )
    }
  }

  async function exportPresentation(
    path: string,
    format: 'pptx' | 'pdf',
  ): Promise<void> {
    if (exportingPathsRef.current.has(path)) return
    exportingPathsRef.current.add(path)
    setOpenPresentations((current) =>
      current.map((candidate) =>
        candidate.path === path
          ? {
              ...candidate,
              isExporting: true,
              exportingFormat: format,
              error: '',
              lastExportPath: undefined,
            }
          : candidate,
      ),
    )
    try {
      const saved = await savePresentation(path)
      if (!saved) return
      const result =
        format === 'pdf'
          ? await window.presentations.exportPdf(project.handle, { path })
          : await window.presentations.export(project.handle, { path })
      if (!result || ('status' in result && result.status === 'canceled'))
        return
      if ('status' in result && result.status === 'failed')
        throw new Error(result.message)
      setOpenPresentations((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? { ...candidate, lastExportPath: result.outputPath }
            : candidate,
        ),
      )
      await refreshVisibleFileTree()
    } catch (error) {
      setOpenPresentations((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                error:
                  error instanceof Error
                    ? error.message
                    : `无法导出 ${format === 'pdf' ? 'PDF' : 'PowerPoint'}`,
              }
            : candidate,
        ),
      )
    } finally {
      exportingPathsRef.current.delete(path)
      setOpenPresentations((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? { ...candidate, isExporting: false, exportingFormat: undefined }
            : candidate,
        ),
      )
    }
  }

  async function exportMarkdown(
    path: string,
    format: 'word' | 'pdf',
  ): Promise<void> {
    const document = openDocuments.find((candidate) => candidate.path === path)
    if (
      !document ||
      document.kind !== 'markdown' ||
      exportingPathsRef.current.has(path)
    )
      return
    exportingPathsRef.current.add(path)

    const content = document.content
    setOpenDocuments((current) =>
      current.map((candidate) =>
        candidate.path === path
          ? {
              ...candidate,
              isExporting: true,
              exportingFormat: format,
              exportError: '',
              lastExportPath: undefined,
              exportWarnings: [],
            }
          : candidate,
      ),
    )
    try {
      const result =
        format === 'pdf'
          ? await window.documentExport.exportPdf(project.handle, {
              path,
              content,
            })
          : await window.documentExport.exportWord(project.handle, {
              path,
              content,
            })
      setOpenDocuments((current) =>
        current.map((candidate) => {
          if (candidate.path !== path) return candidate
          if (result.status === 'canceled') return candidate
          if (result.status === 'failed') {
            return { ...candidate, exportError: result.message }
          }
          return {
            ...candidate,
            lastExportPath: result.outputPath,
            exportWarnings: 'warnings' in result ? result.warnings : [],
          }
        }),
      )
      if (result.status === 'exported') await refreshVisibleFileTree()
    } catch (error) {
      setOpenDocuments((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                exportError:
                  error instanceof Error
                    ? error.message
                    : `无法导出 ${format === 'pdf' ? 'PDF' : 'Word'}`,
              }
            : candidate,
        ),
      )
    } finally {
      exportingPathsRef.current.delete(path)
      setOpenDocuments((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? { ...candidate, isExporting: false, exportingFormat: undefined }
            : candidate,
        ),
      )
    }
  }

  function updateDocument(path: string, content: string): void {
    setOpenDocuments((current) =>
      current.map((document) =>
        document.path === path ? { ...document, content, error: '' } : document,
      ),
    )
  }

  function updateDocumentViewMode(
    path: string,
    viewMode: MarkdownViewMode,
  ): void {
    setOpenDocuments((current) =>
      current.map((document) =>
        document.path === path ? { ...document, viewMode } : document,
      ),
    )
  }

  async function saveDocument(path: string): Promise<void> {
    const document = openDocuments.find((candidate) => candidate.path === path)
    if (
      !document ||
      document.isSaving ||
      document.conflict ||
      document.content === document.savedContent
    )
      return

    const savedContent = document.content
    setOpenDocuments((current) =>
      current.map((candidate) =>
        candidate.path === path
          ? { ...candidate, isSaving: true, error: '' }
          : candidate,
      ),
    )
    try {
      const result = await window.projects.saveTextFile(project.handle, {
        path,
        content: savedContent,
        revision: document.revision,
        hasBom: document.hasBom,
      })
      setOpenDocuments((current) =>
        current.map((candidate) => {
          if (candidate.path !== path) return candidate
          if (!result.ok) {
            return {
              ...candidate,
              isSaving: false,
              conflict: true,
              error: '文件已被其他程序修改。重新载入会放弃当前未保存内容。',
            }
          }
          return {
            ...candidate,
            savedContent,
            revision: result.revision,
            isSaving: false,
            conflict: false,
            error: '',
          }
        }),
      )
    } catch (error) {
      setOpenDocuments((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                isSaving: false,
                error: error instanceof Error ? error.message : '无法保存文件',
              }
            : candidate,
        ),
      )
    }
  }

  async function reloadDocument(path: string): Promise<void> {
    const document = openDocuments.find((candidate) => candidate.path === path)
    if (!document) return
    if (
      document.content !== document.savedContent &&
      !window.confirm(`重新载入 ${document.name}？当前未保存内容将丢失。`)
    )
      return

    try {
      const file = await window.projects.readTextFile(project.handle, path)
      setOpenDocuments((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                ...file,
                savedContent: file.content,
                isSaving: false,
                conflict: false,
                error: '',
              }
            : candidate,
        ),
      )
    } catch (error) {
      setOpenDocuments((current) =>
        current.map((candidate) =>
          candidate.path === path
            ? {
                ...candidate,
                error:
                  error instanceof Error ? error.message : '无法重新载入文件',
              }
            : candidate,
        ),
      )
    }
  }

  function closeDocument(path: string): void {
    const documentIndex = openDocuments.findIndex(
      (document) => document.path === path,
    )
    const document = openDocuments[documentIndex]
    if (!document) return
    if (
      document.content !== document.savedContent &&
      !window.confirm(`关闭 ${document.name}？当前未保存内容将丢失。`)
    )
      return

    const remaining = openDocuments.filter(
      (candidate) => candidate.path !== path,
    )
    setOpenDocuments(remaining)
    if (activeDocumentPath === path) {
      const nextDocument =
        remaining[Math.min(documentIndex, remaining.length - 1)]
      setActiveDocumentPath(
        nextDocument?.path ??
          openPresentations.at(-1)?.path ??
          openImages.at(-1)?.path ??
          null,
      )
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const prompt = draft.trim()
    if (
      !prompt ||
      isSending ||
      isConversationLoading ||
      loadingConversationIds.has(selectedConversation.id)
    )
      return

    if (promptReferences.length > 20) {
      setChatError('单条消息最多引用 20 个文件或 skill')
      return
    }

    const conversationId = selectedConversation.id
    const requestId = crypto.randomUUID()
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: prompt,
    }
    const assistantMessage: ChatMessage = {
      id: requestId,
      role: 'assistant',
      text: '',
      isStreaming: true,
    }
    setDraft('')
    setKnownReferences([])
    setReferenceTrigger(null)
    setChatError('')
    setActiveAgentRequest({ requestId, conversationId })
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title:
                conversation.messages.length === 0
                  ? prompt.slice(0, 24)
                  : conversation.title,
              messages: [
                ...conversation.messages,
                userMessage,
                assistantMessage,
              ],
            }
          : conversation,
      ),
    )

    try {
      const result = await window.agent.prompt({
        requestId,
        conversationId,
        projectHandle: project.handle,
        input: prompt,
        references: promptReferences,
        thinkingLevel,
      })
      streamBuffer.flush()
      const wasStopped = stoppedRequestIdsRef.current.has(requestId)
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === requestId
                    ? {
                        ...message,
                        text: result.text,
                        isStreaming: false,
                        activities: wasStopped
                          ? stopRunningAgentActivities(message.activities ?? [])
                          : message.activities,
                      }
                    : message,
                ),
              }
            : conversation,
        ),
      )
    } catch (error) {
      streamBuffer.flush()
      const wasStopped = stoppedRequestIdsRef.current.has(requestId)
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: conversation.messages.flatMap((message) => {
                  if (message.id !== requestId) return [message]
                  if (!message.text && !message.activities?.length) return []
                  return [
                    {
                      ...message,
                      isStreaming: false,
                      activities: wasStopped
                        ? stopRunningAgentActivities(message.activities ?? [])
                        : message.activities?.map((activity) =>
                            activity.status === 'running'
                              ? { ...activity, status: 'error' as const }
                              : activity,
                          ),
                    },
                  ]
                }),
              }
            : conversation,
        ),
      )
      if (!wasStopped) {
        setChatError(
          error instanceof Error ? error.message : '暂时无法获取回复',
        )
      }
    } finally {
      stoppedRequestIdsRef.current.delete(requestId)
      setActiveAgentRequest((current) =>
        current?.requestId === requestId ? null : current,
      )
      setIsStopping(false)
      setUsageRevisionByConversation((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? 0) + 1,
      }))
    }
  }

  async function stopMessage(): Promise<void> {
    if (!activeAgentRequest || isStopping) return
    const request = activeAgentRequest
    stoppedRequestIdsRef.current.add(request.requestId)
    setIsStopping(true)
    setChatError('')

    try {
      const result = await window.agent.stop({
        requestId: request.requestId,
        conversationId: request.conversationId,
        projectHandle: project.handle,
      })
      if (!result.stopped)
        stoppedRequestIdsRef.current.delete(request.requestId)
    } catch (error) {
      stoppedRequestIdsRef.current.delete(request.requestId)
      setChatError(error instanceof Error ? error.message : '无法终止当前回复')
      setIsStopping(false)
    }
  }

  function handleComposerKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (event.nativeEvent.isComposing) return
    if (referenceTrigger) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (filteredReferenceOptions.length > 0) {
          const direction = event.key === 'ArrowDown' ? 1 : -1
          setActiveReferenceIndex(
            (current) =>
              (current + direction + filteredReferenceOptions.length) %
              filteredReferenceOptions.length,
          )
        }
        return
      }
      if (
        (event.key === 'Enter' || event.key === 'Tab') &&
        filteredReferenceOptions.length > 0
      ) {
        event.preventDefault()
        selectComposerReference(
          filteredReferenceOptions[
            Math.min(activeReferenceIndex, filteredReferenceOptions.length - 1)
          ],
        )
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setReferenceTrigger(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (isSending) return
      event.currentTarget.form?.requestSubmit()
    }
  }

  function updateReferenceTrigger(
    value: string,
    selectionStart: number | null,
  ): void {
    setReferenceTrigger(findComposerReferenceTrigger(value, selectionStart))
    setActiveReferenceIndex(0)
  }

  function selectComposerReference(option: ComposerReferenceOption): void {
    if (!referenceTrigger) return
    if (promptReferences.length >= 20) {
      setChatError('单条消息最多引用 20 个文件或 skill')
      return
    }

    const next = insertComposerReference(
      draft,
      referenceTrigger,
      option.reference,
    )
    setDraft(next.value)
    setKnownReferences((current) => [
      ...current.filter(
        (reference) => promptReferenceKey(reference) !== option.key,
      ),
      option.reference,
    ])
    setReferenceTrigger(null)
    setChatError('')
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus()
      composerTextareaRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  function openHistory(): void {
    setIsHistoryOpen(true)
    setIsHistoryActive(true)
  }

  function confirmVersionRestore(paths: string[]): boolean {
    const dirtyPaths = paths.filter((path) => {
      const document = openDocumentsRef.current.find(
        (candidate) => candidate.path === path,
      )
      if (document && document.content !== document.savedContent) return true
      const presentation = openPresentationsRef.current.find(
        (candidate) => candidate.path === path,
      )
      return Boolean(
        presentation &&
          presentation.serializedDocument !==
            presentation.savedSerializedDocument,
      )
    })
    const message =
      dirtyPaths.length > 0
        ? `以下文件有未保存内容，恢复会放弃这些修改：\n\n${dirtyPaths.join('\n')}\n\n继续恢复吗？`
        : `将 ${paths.length} 个文件恢复为所选版本状态。恢复后的文件状态会纳入自动版本记录，是否继续？`
    if (!window.confirm(message)) return false
    for (const path of paths) confirmedRestorePathsRef.current.add(path)
    return true
  }

  function settleVersionRestore(paths: string[]): void {
    window.setTimeout(() => {
      for (const path of paths) confirmedRestorePathsRef.current.delete(path)
    }, 3_000)
  }

  const titleBarActionSlot = globalThis.document.getElementById(
    'app-title-bar-actions',
  )

  return (
    <section
      ref={workspaceRef}
      className="project-workspace"
      style={{
        gridTemplateColumns: isSidebarCollapsed
          ? 'minmax(0, 1fr)'
          : `${effectiveSidebarWidth}px 6px minmax(0, 1fr)`,
      }}
      aria-label={`${project.name} 项目工作区`}
    >
      {pendingPresentationImport ? (
        <PptxImportFrame
          request={pendingPresentationImport}
          onImported={(requestId, document) =>
            void completePptxImport(requestId, document)
          }
          onError={failPptxImport}
        />
      ) : null}
      {titleBarActionSlot
        ? createPortal(
            <div className="title-bar-actions" aria-label="编辑操作">
              {activeFile || isHistoryActive ? (
                <button
                  className={`workspace-history-button${isHistoryActive ? ' workspace-history-button-active' : ''}`}
                  type="button"
                  title="版本历史 (Ctrl/⌘ Shift H)"
                  aria-pressed={isHistoryActive}
                  onClick={openHistory}
                >
                  <HistoryIcon />
                  <span>版本历史</span>
                </button>
              ) : null}
              {!isHistoryActive && activeDocument ? (
                <>
                  {activeDocument.kind === 'markdown' ? (
                    <>
                      <div
                        className="workspace-view-switch"
                        aria-label="Markdown 查看方式"
                      >
                        {(['edit', 'split', 'preview'] as const).map((mode) => (
                          <button
                            className={
                              activeDocument.viewMode === mode
                                ? 'workspace-view-active'
                                : ''
                            }
                            key={mode}
                            type="button"
                            aria-pressed={activeDocument.viewMode === mode}
                            onClick={() =>
                              updateDocumentViewMode(activeDocument.path, mode)
                            }
                          >
                            {mode === 'edit'
                              ? '编辑'
                              : mode === 'split'
                                ? '分栏'
                                : '预览'}
                          </button>
                        ))}
                      </div>
                      <WorkspaceExportMenu
                        key={activeDocument.path}
                        options={[
                          {
                            format: 'word',
                            label: 'Word',
                            description: '导出当前内容，不保存源文件',
                          },
                          {
                            format: 'pdf',
                            label: 'PDF',
                            description: '导出当前内容，不保存源文件',
                          },
                        ]}
                        exportingFormat={activeDocument.exportingFormat}
                        disabled={activeDocument.isExporting}
                        onExport={(format) =>
                          void exportMarkdown(activeDocument.path, format)
                        }
                      />
                    </>
                  ) : null}
                  <button
                    className="workspace-save-button"
                    type="button"
                    title="保存 (Ctrl/⌘S)"
                    aria-label={`保存 ${activeDocument.name}`}
                    onClick={() => void saveDocument(activeDocument.path)}
                    disabled={
                      activeDocument.content === activeDocument.savedContent ||
                      activeDocument.isSaving ||
                      activeDocument.conflict
                    }
                  >
                    保存
                  </button>
                </>
              ) : !isHistoryActive && activePresentation ? (
                <>
                  <WorkspaceExportMenu
                    key={activePresentation.path}
                    options={[
                      {
                        format: 'pptx',
                        label: 'PPTX',
                        description: '先保存演示文稿，再导出',
                      },
                      {
                        format: 'pdf',
                        label: 'PDF',
                        description: '先保存；动画和视频使用静态画面',
                      },
                    ]}
                    exportingFormat={activePresentation.exportingFormat}
                    disabled={
                      activePresentation.isSaving ||
                      activePresentation.isExporting ||
                      activePresentation.conflict
                    }
                    onExport={(format) =>
                      void exportPresentation(activePresentation.path, format)
                    }
                  />
                  <button
                    className="workspace-save-button"
                    type="button"
                    title="保存 (Ctrl/⌘S)"
                    aria-label={`保存 ${activePresentation.name}`}
                    onClick={() =>
                      void savePresentation(activePresentation.path)
                    }
                    disabled={
                      activePresentation.serializedDocument ===
                        activePresentation.savedSerializedDocument ||
                      activePresentation.isSaving ||
                      activePresentation.isExporting ||
                      activePresentation.conflict
                    }
                  >
                    保存
                  </button>
                </>
              ) : null}
            </div>,
            titleBarActionSlot,
          )
        : null}
      <aside
        className="project-sidebar"
        id="project-sidebar"
        hidden={isSidebarCollapsed}
        style={{
          gridTemplateRows: `${effectiveConversationHeight}px 6px minmax(0, 1fr)`,
        }}
      >
        <section
          className="conversation-pane"
          aria-labelledby="conversation-list-title"
        >
          <header className="sidebar-section-heading">
            <div>
              <span>{project.name}</span>
              <h2 id="conversation-list-title">对话</h2>
            </div>
            <button
              type="button"
              onClick={startConversation}
              disabled={isConversationLoading}
              aria-label="新建对话"
              title="新建对话"
            >
              ＋
            </button>
          </header>
          <div className="conversation-filter">
            <button
              type="button"
              aria-label="筛选会话"
              aria-expanded={isConversationFilterOpen}
              aria-controls="conversation-filter-options"
              onClick={() => setIsConversationFilterOpen((open) => !open)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3 5h14M6 10h8M8 15h4" />
              </svg>
              {conversationFilter === 'active'
                ? '未归档'
                : conversationFilter === 'archived'
                  ? '已归档'
                  : '全部会话'}
              <span>⌄</span>
            </button>
            {isConversationFilterOpen ? (
              <div
                id="conversation-filter-options"
                className="conversation-filter-options"
                role="group"
                aria-label="会话筛选条件"
              >
                {(['active', 'archived', 'all'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={conversationFilter === filter}
                    onClick={() => {
                      setConversationFilter(filter)
                      setIsConversationFilterOpen(false)
                    }}
                  >
                    {filter === 'active'
                      ? '未归档'
                      : filter === 'archived'
                        ? '已归档'
                        : '全部'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="conversation-list">
            {visibleConversations.map((conversation) => (
              <div className="conversation-row" key={conversation.id}>
                <button
                  className={
                    conversation.id === selectedConversation.id
                      ? 'conversation-item conversation-item-active'
                      : 'conversation-item'
                  }
                  type="button"
                  title={conversation.title}
                  onClick={() => void selectConversation(conversation.id)}
                >
                  <ConversationIcon />
                  <span>{conversation.title}</span>
                  {conversation.archived ? <small>已归档</small> : null}
                </button>
                <button
                  className="conversation-archive-button"
                  type="button"
                  disabled={!canPersistConversations || isConversationLoading}
                  aria-label={`${conversation.archived ? '取消归档' : '归档'}：${conversation.title}`}
                  title={conversation.archived ? '取消归档' : '归档'}
                  onClick={() =>
                    setConversations((current) =>
                      current.map((item) =>
                        item.id === conversation.id
                          ? { ...item, archived: !item.archived }
                          : item,
                      ),
                    )
                  }
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3 7h14V4H3zM4 7v10h12V7" />
                    <path
                      d={
                        conversation.archived
                          ? 'M10 14V9m-2 2 2-2 2 2'
                          : 'M8 10h4'
                      }
                    />
                  </svg>
                </button>
              </div>
            ))}
            {visibleConversations.length === 0 ? (
              <p className="conversation-empty">
                {conversationFilter === 'archived'
                  ? '暂无已归档会话'
                  : '暂无未归档会话'}
              </p>
            ) : null}
          </div>
        </section>

        <WorkspaceResizeHandle
          orientation="horizontal"
          label="调整对话与文件区域高度"
          value={effectiveConversationHeight}
          min={120}
          max={sidebarMaxHeight}
          onChange={setConversationHeight}
        />
        <section className="file-pane" aria-labelledby="project-files-title">
          <header className="sidebar-section-heading file-heading">
            <div>
              <span>项目内容</span>
              <h2 id="project-files-title">文件</h2>
            </div>
            <div className="file-create-control" ref={createMenuRef}>
              <input
                ref={pptxImportInputRef}
                className="sr-only"
                type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void preparePptxImport(event)}
              />
              <button
                className="file-create-trigger"
                type="button"
                aria-label="新建项目内容"
                aria-expanded={isCreateMenuOpen}
                aria-haspopup="menu"
                title="新建"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    setIsCreateMenuOpen(true)
                  }
                }}
                onClick={() => setIsCreateMenuOpen((current) => !current)}
              >
                ＋
              </button>
              {isCreateMenuOpen ? (
                <div
                  className="file-create-menu"
                  role="menu"
                  aria-label="新建项目内容"
                  style={{ width: Math.min(218, effectiveSidebarWidth - 32) }}
                  onClick={(event) => {
                    if (
                      !(event.target instanceof HTMLButtonElement) ||
                      event.target.disabled
                    )
                      return
                    createMenuRef.current
                      ?.querySelector<HTMLButtonElement>('.file-create-trigger')
                      ?.focus()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab') {
                      setIsCreateMenuOpen(false)
                      createMenuRef.current
                        ?.querySelector<HTMLButtonElement>(
                          '.file-create-trigger',
                        )
                        ?.focus()
                      return
                    }
                    if (
                      !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(
                        event.key,
                      )
                    )
                      return
                    event.preventDefault()
                    const items = [
                      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        '[role="menuitem"]:not(:disabled)',
                      ),
                    ]
                    const index = items.indexOf(
                      event.target as HTMLButtonElement,
                    )
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? items.length - 1
                          : (index +
                              (event.key === 'ArrowUp' ? -1 : 1) +
                              items.length) %
                            items.length
                    items[next].focus()
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void createDirectory()}
                  >
                    新建文件夹
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(pendingPresentationImport)}
                    onClick={choosePptxImport}
                  >
                    从 PowerPoint (.pptx) 导入
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void createPresentation()}
                  >
                    新建演示文稿
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void createMarkdownDocument()}
                  >
                    新建 Markdown 文档
                  </button>
                </div>
              ) : null}
            </div>
          </header>
          <div className="file-tree-scroll">
            {pendingPresentationImport ? (
              <p className="sidebar-loading" aria-live="polite">
                正在导入 {pendingPresentationImport.fileName}…
              </p>
            ) : null}
            {fileError ? (
              <p className="sidebar-error" role="alert">
                {fileError}
              </p>
            ) : null}
            {loadingPaths.has('') ? (
              <p className="sidebar-loading">正在读取文件…</p>
            ) : (
              <FileTreeLevel
                directoryPath=""
                depth={0}
                entriesByDirectory={entriesByDirectory}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                activeFilePath={activeDocumentPath}
                selectedFilePath={selectedFilePath}
                treeTabStopPath={treeTabStopPath}
                renameRequestedPath={renameRequestedPath}
                onOpenFile={(entry) => void openFile(entry)}
                onDeleteFile={(entry) => void deleteEntry(entry)}
                onRenameFile={renameEntry}
                onRenameRequestHandled={() => setRenameRequestedPath(null)}
                onSelectFile={setSelectedFilePath}
                onToggle={(entry) => void toggleDirectory(entry)}
              />
            )}
          </div>
        </section>
      </aside>

      {!isSidebarCollapsed ? (
        <WorkspaceResizeHandle
          orientation="vertical"
          label="调整侧栏宽度"
          value={effectiveSidebarWidth}
          min={220}
          max={sidebarMaxWidth}
          onChange={setSidebarWidth}
        />
      ) : null}
      <section className="workspace-main">
        <header className="workspace-bar">
          <button
            className="workspace-sidebar-toggle"
            type="button"
            aria-label={isSidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            title={isSidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            aria-expanded={!isSidebarCollapsed}
            aria-controls="project-sidebar"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            {isSidebarCollapsed ? '▸' : '◂'}
          </button>
          <nav
            className="workspace-tabs"
            aria-label="打开的内容"
            role="tablist"
            onKeyDown={(event) => {
              if (
                !(event.target instanceof HTMLElement) ||
                event.target.getAttribute('role') !== 'tab'
              )
                return
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return
              event.preventDefault()
              const tabs = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                ),
              ]
              const index = tabs.indexOf(event.target as HTMLButtonElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index +
                        (event.key === 'ArrowLeft' ? -1 : 1) +
                        tabs.length) %
                      tabs.length
              tabs[next].focus()
              tabs[next].click()
            }}
          >
            <button
              className={`workspace-tab workspace-chat-tab${activeFile || isHistoryActive ? '' : ' workspace-tab-active'}`}
              type="button"
              role="tab"
              aria-selected={!activeFile && !isHistoryActive}
              tabIndex={!activeFile && !isHistoryActive ? 0 : -1}
              onClick={() => {
                setIsHistoryActive(false)
                setActiveDocumentPath(null)
              }}
            >
              <ConversationIcon />
              <span>{selectedConversation.title}</span>
            </button>
            {openDocuments.map((document) => {
              const isDirty = document.content !== document.savedContent
              const isActive =
                !isHistoryActive && document.path === activeDocument?.path
              const status = document.conflict
                ? '保存冲突'
                : document.isSaving
                  ? '正在保存'
                  : isDirty
                    ? '未保存'
                    : '已保存'
              return (
                <div
                  className={`workspace-document-tab${isActive ? ' workspace-tab-active' : ''}`}
                  key={document.path}
                  role="presentation"
                >
                  <button
                    className="workspace-document-tab-main"
                    type="button"
                    role="tab"
                    aria-label={`${document.name}，${status}`}
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    title={document.path}
                    onClick={() => {
                      setIsHistoryActive(false)
                      setActiveDocumentPath(document.path)
                      setSelectedFilePath(document.path)
                    }}
                  >
                    <FileIcon />
                    <span>{document.name}</span>
                    {isDirty ? (
                      <i
                        className={`${document.isSaving ? 'document-status-saving' : ''}${document.conflict ? ' document-status-conflict' : ''}`}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                  <button
                    className="workspace-tab-close"
                    type="button"
                    aria-label={`关闭 ${document.name}`}
                    onClick={() => closeDocument(document.path)}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            {openPresentations.map((presentation) => {
              const isDirty =
                presentation.serializedDocument !==
                presentation.savedSerializedDocument
              const isActive =
                !isHistoryActive &&
                presentation.path === activePresentation?.path
              const status = presentation.conflict
                ? '保存冲突'
                : presentation.isSaving
                  ? '正在保存'
                  : isDirty
                    ? '未保存'
                    : '已保存'
              return (
                <div
                  className={`workspace-document-tab${isActive ? ' workspace-tab-active' : ''}`}
                  key={presentation.path}
                  role="presentation"
                >
                  <button
                    className="workspace-document-tab-main"
                    type="button"
                    role="tab"
                    aria-label={`${presentation.name}，${status}`}
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    title={presentation.path}
                    onClick={() => {
                      setIsHistoryActive(false)
                      setActiveDocumentPath(presentation.path)
                      setSelectedFilePath(presentation.path)
                    }}
                  >
                    <FileIcon />
                    <span>{presentation.name}</span>
                    {isDirty ? (
                      <i
                        className={`${presentation.isSaving ? 'document-status-saving' : ''}${presentation.conflict ? ' document-status-conflict' : ''}`}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                  <button
                    className="workspace-tab-close"
                    type="button"
                    aria-label={`关闭 ${presentation.name}`}
                    onClick={() => closePresentation(presentation.path)}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            {openImages.map((image) => {
              const isActive =
                !isHistoryActive && image.path === activeImage?.path
              return (
                <div
                  className={`workspace-document-tab${isActive ? ' workspace-tab-active' : ''}`}
                  key={image.path}
                  role="presentation"
                >
                  <button
                    className="workspace-document-tab-main"
                    type="button"
                    role="tab"
                    aria-label={`${image.name}，图片预览`}
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    title={image.path}
                    onClick={() => {
                      setIsHistoryActive(false)
                      setActiveDocumentPath(image.path)
                      setSelectedFilePath(image.path)
                    }}
                  >
                    <FileIcon />
                    <span>{image.name}</span>
                  </button>
                  <button
                    className="workspace-tab-close"
                    type="button"
                    aria-label={`关闭 ${image.name}`}
                    onClick={() => closeImage(image.path)}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            {isHistoryOpen ? (
              <div
                className={`workspace-document-tab${isHistoryActive ? ' workspace-tab-active' : ''}`}
                role="presentation"
              >
                <button
                  className="workspace-document-tab-main workspace-history-tab-main"
                  type="button"
                  role="tab"
                  aria-selected={isHistoryActive}
                  tabIndex={isHistoryActive ? 0 : -1}
                  onClick={() => setIsHistoryActive(true)}
                >
                  <HistoryIcon />
                  <span>版本历史</span>
                </button>
                <button
                  className="workspace-tab-close"
                  type="button"
                  aria-label="关闭版本历史"
                  onClick={() => {
                    setIsHistoryOpen(false)
                    setIsHistoryActive(false)
                  }}
                >
                  ×
                </button>
              </div>
            ) : null}
          </nav>
        </header>

        {isHistoryActive ? (
          <ProjectHistoryPanel
            projectHandle={project.handle}
            onConfirmRestore={confirmVersionRestore}
            onRestoreSettled={settleVersionRestore}
          />
        ) : activeDocument ? (
          <DocumentEditor
            key={activeDocument.path}
            document={activeDocument}
            onChange={(content) => updateDocument(activeDocument.path, content)}
            onReload={() => void reloadDocument(activeDocument.path)}
            onSave={() => void saveDocument(activeDocument.path)}
            projectHandle={project.handle}
          />
        ) : activePresentation ? (
          <Suspense
            fallback={<p className="sidebar-loading">正在加载演示编辑器…</p>}
          >
            <PresentationEditor
              key={`${activePresentation.path}:${activePresentation.reloadKey}`}
              document={activePresentation}
              onChange={(document) =>
                updatePresentation(activePresentation.path, document)
              }
              onReload={() => void reloadPresentation(activePresentation.path)}
              onSave={(document) =>
                void savePresentation(activePresentation.path, document)
              }
            />
          </Suspense>
        ) : activeImage ? (
          <ImagePreview
            key={`${activeImage.path}:${activeImage.revision}`}
            document={activeImage}
          />
        ) : (
          <section
            className="chat-panel"
            aria-labelledby="active-conversation-title"
          >
            <h1 id="active-conversation-title" className="sr-only">
              {selectedConversation.title}
            </h1>

            <div
              className="message-stream"
              aria-live="polite"
              onScroll={(event) => {
                followMessagesRef.current = isNearMessageBottom(
                  event.currentTarget,
                )
              }}
            >
              {loadingConversationIds.has(selectedConversation.id) ? (
                <p className="sidebar-loading">正在加载 Pi 会话…</p>
              ) : selectedConversation.messages.length === 0 ? (
                <div className="chat-empty">
                  <span className="chat-empty-mark" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <h2>从项目材料开始思考</h2>
                  <p>
                    描述你的演示目标、受众或手头的问题，SlideMind
                    会和你一起梳理叙事。
                  </p>
                </div>
              ) : (
                <div className="message-list">
                  {selectedConversation.messages.map((message) => (
                    <article
                      className={`chat-message chat-message-${message.role}${message.isStreaming && !message.text && !message.activities?.length ? ' chat-message-loading' : ''}${message.isStreaming && message.text ? ' chat-message-streaming' : ''}`}
                      key={message.id}
                    >
                      <span>{message.role === 'user' ? '你' : 'SM'}</span>
                      {message.role === 'assistant' ? (
                        <div className="chat-assistant-response">
                          <AgentActivityPanel
                            activities={message.activities ?? []}
                            isStreaming={Boolean(message.isStreaming)}
                          />
                          {message.isStreaming &&
                          !message.text &&
                          !message.activities?.length ? (
                            <p className="chat-message-placeholder">
                              <i />
                              <i />
                              <i />
                            </p>
                          ) : message.text ? (
                            <AgentMarkdown source={message.text} />
                          ) : null}
                        </div>
                      ) : message.isStreaming && !message.text ? (
                        <p>
                          <i />
                          <i />
                          <i />
                        </p>
                      ) : (
                        <p>{message.text}</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <div ref={messageEndRef} />
            </div>

            <form
              className="chat-composer"
              onSubmit={(event) => void sendMessage(event)}
            >
              <TodoProgress todos={selectedTodos} />
              {conversationError ? (
                <p className="composer-error" role="alert">
                  {conversationError}
                </p>
              ) : null}
              {chatError ? (
                <p className="composer-error" role="alert">
                  {chatError}
                </p>
              ) : null}
              {referenceOptionsError ? (
                <p className="composer-error" role="alert">
                  {referenceOptionsError}
                </p>
              ) : null}
              <ConversationUsageBar
                isLoading={loadingUsageIds.has(selectedConversation.id)}
                isUpdating={isSelectedConversationSending}
                usage={selectedUsage}
              />
              <div className="composer-input-shell">
                {referenceTrigger ? (
                  <div
                    className="composer-reference-menu"
                    role="listbox"
                    id="composer-reference-options"
                  >
                    <header>
                      <span>
                        {referenceTrigger.type === 'file'
                          ? '项目文件'
                          : '可用 Skills'}
                      </span>
                      <small>
                        {referenceTrigger.type === 'file'
                          ? '@ 引用材料'
                          : '/ 注入工作流'}
                      </small>
                    </header>
                    {isReferenceOptionsLoading ? (
                      <p>正在建立项目索引…</p>
                    ) : filteredReferenceOptions.length === 0 ? (
                      <p>
                        {referenceTrigger.query
                          ? `没有匹配“${referenceTrigger.query}”的结果`
                          : referenceTrigger.type === 'file'
                            ? '项目中没有可引用的文件'
                            : '当前没有注入的 skill'}
                      </p>
                    ) : (
                      <div className="composer-reference-list">
                        {filteredReferenceOptions.map((option, index) => (
                          <button
                            className={
                              index === activeReferenceIndex ? 'is-active' : ''
                            }
                            id={`composer-reference-option-${index}`}
                            key={option.key}
                            type="button"
                            role="option"
                            aria-selected={index === activeReferenceIndex}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveReferenceIndex(index)}
                            onClick={() => selectComposerReference(option)}
                          >
                            <span
                              className={`composer-reference-badge composer-reference-${option.reference.type}`}
                            >
                              {option.badge}
                            </span>
                            <span>
                              <strong>{option.title}</strong>
                              <small>{option.description}</small>
                            </span>
                            <kbd>
                              {index === activeReferenceIndex ? '↵' : ''}
                            </kbd>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="composer-box">
                  <textarea
                    ref={composerTextareaRef}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      updateReferenceTrigger(
                        event.target.value,
                        event.target.selectionStart,
                      )
                    }}
                    onSelect={(event) =>
                      updateReferenceTrigger(
                        event.currentTarget.value,
                        event.currentTarget.selectionStart,
                      )
                    }
                    onKeyDown={handleComposerKeyDown}
                    placeholder="输入消息，@ 引用文件，/ 使用 skill…"
                    rows={2}
                    disabled={
                      isConversationLoading ||
                      loadingConversationIds.has(selectedConversation.id)
                    }
                    aria-label="对话消息"
                    aria-autocomplete="list"
                    aria-controls={
                      referenceTrigger
                        ? 'composer-reference-options'
                        : undefined
                    }
                    aria-expanded={Boolean(referenceTrigger)}
                    aria-activedescendant={
                      referenceTrigger && filteredReferenceOptions.length > 0
                        ? `composer-reference-option-${Math.min(activeReferenceIndex, filteredReferenceOptions.length - 1)}`
                        : undefined
                    }
                  />
                  <div className="composer-footer">
                    <span aria-live="polite">
                      {isStopping
                        ? '正在终止 Pi Agent…'
                        : isSending
                          ? '回复进行中，可编辑草稿；结束后可发送'
                          : 'Enter 发送 · Shift+Enter 换行 · @ 文件 · / Skill'}
                    </span>
                    <div className="composer-actions">
                      <AgentModelSelect
                        disabled={
                          isSending ||
                          isConversationLoading ||
                          loadingConversationIds.has(selectedConversation.id)
                        }
                        thinkingLevel={thinkingLevel}
                        onThinkingLevelChange={setThinkingLevel}
                      />
                      <button
                        className={`composer-send${isSending ? ' is-running' : ''}${isStopping ? ' is-stopping' : ''}`}
                        type={isSending ? 'button' : 'submit'}
                        disabled={
                          isSending
                            ? isStopping
                            : (!draft.trim() &&
                                promptReferences.length === 0) ||
                              isConversationLoading ||
                              loadingConversationIds.has(
                                selectedConversation.id,
                              )
                        }
                        aria-label={
                          isStopping
                            ? '正在终止回复'
                            : isSending
                              ? '终止当前回复'
                              : '发送消息'
                        }
                        title={
                          isStopping
                            ? '正在终止回复'
                            : isSending
                              ? '终止当前回复'
                              : '发送消息'
                        }
                        onClick={
                          isSending ? () => void stopMessage() : undefined
                        }
                      >
                        {isSending ? (
                          <span
                            className="composer-send-progress"
                            aria-hidden="true"
                          >
                            <i />
                          </span>
                        ) : (
                          <span aria-hidden="true">↑</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </section>
        )}
      </section>
    </section>
  )
}
