import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import type {
  ConversationMessage,
  OpenedProject,
  ProjectConversationState,
  ProjectFileEntry
} from '../../../shared/project'
import { AgentModelSelect } from './agent-model-select'
import {
  DocumentEditor,
  type MarkdownViewMode,
  type OpenTextDocument
} from './document-editor'

interface ChatMessage extends ConversationMessage {
  isStreaming?: boolean
}

interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
}

interface ProjectWorkspaceProps {
  project: OpenedProject
  onDirtyChange: (isDirty: boolean) => void
}

interface FileTreeLevelProps {
  directoryPath: string
  depth: number
  entriesByDirectory: Readonly<Record<string, ProjectFileEntry[]>>
  expandedPaths: ReadonlySet<string>
  loadingPaths: ReadonlySet<string>
  activeFilePath: string | null
  selectedFilePath: string | null
  onOpenFile: (entry: ProjectFileEntry) => void
  onSelectFile: (path: string) => void
  onToggle: (entry: ProjectFileEntry) => void
}

function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: '新对话',
    messages: []
  }
}

function toPersistedState(
  conversations: Conversation[],
  selectedConversationId: string
): ProjectConversationState {
  return {
    selectedConversationId,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title
    }))
  }
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

function FileTreeLevel({
  directoryPath,
  depth,
  entriesByDirectory,
  expandedPaths,
  loadingPaths,
  activeFilePath,
  selectedFilePath,
  onOpenFile,
  onSelectFile,
  onToggle
}: FileTreeLevelProps): React.JSX.Element {
  const entries = entriesByDirectory[directoryPath] ?? []

  return (
    <div role={depth === 0 ? 'tree' : 'group'}>
      {entries.map((entry) => {
        const isDirectory = entry.kind === 'directory'
        const isExpanded = expandedPaths.has(entry.path)
        const isLoading = loadingPaths.has(entry.path)
        return (
          <div className="file-tree-branch" key={entry.path}>
            <button
              className={`file-tree-item${isDirectory ? ' file-tree-directory' : ''}${entry.path === selectedFilePath ? ' file-tree-item-selected' : ''}${entry.path === activeFilePath ? ' file-tree-item-active' : ''}`}
              style={{ '--tree-depth': depth } as React.CSSProperties}
              type="button"
              role="treeitem"
              aria-expanded={isDirectory ? isExpanded : undefined}
              onClick={() => {
                if (isDirectory) onToggle(entry)
                else onSelectFile(entry.path)
              }}
              onDoubleClick={() => {
                if (!isDirectory) onOpenFile(entry)
              }}
              onKeyDown={(event) => {
                if (!isDirectory && event.key === 'Enter') onOpenFile(entry)
              }}
              tabIndex={0}
            >
              <span className="tree-chevron" aria-hidden="true">
                {isDirectory ? (isLoading ? '·' : isExpanded ? '⌄' : '›') : ''}
              </span>
              <span className="tree-entry-icon" aria-hidden="true">
                {isDirectory ? <FolderIcon /> : <FileIcon />}
              </span>
              <span title={entry.path}>{entry.name}</span>
            </button>
            {isDirectory && isExpanded ? (
              <FileTreeLevel
                directoryPath={entry.path}
                depth={depth + 1}
                entriesByDirectory={entriesByDirectory}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                activeFilePath={activeFilePath}
                selectedFilePath={selectedFilePath}
                onOpenFile={onOpenFile}
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

export function ProjectWorkspace({ project, onDirtyChange }: ProjectWorkspaceProps): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(() => [createConversation()])
  const [selectedConversationId, setSelectedConversationId] = useState(() => conversations[0].id)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [conversationError, setConversationError] = useState('')
  const [isConversationLoading, setIsConversationLoading] = useState(true)
  const [canPersistConversations, setCanPersistConversations] = useState(false)
  const [loadedConversationIds, setLoadedConversationIds] = useState<Set<string>>(new Set())
  const [loadingConversationIds, setLoadingConversationIds] = useState<Set<string>>(new Set())
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, ProjectFileEntry[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set(['']))
  const [fileError, setFileError] = useState('')
  const [openDocuments, setOpenDocuments] = useState<OpenTextDocument[]>([])
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [openingFilePaths, setOpeningFilePaths] = useState<Set<string>>(new Set())
  const messageEndRef = useRef<HTMLDivElement>(null)
  const lastSavedConversationSnapshotRef = useRef('')
  const latestConversationStateRef = useRef<ProjectConversationState>(
    toPersistedState(conversations, selectedConversationId)
  )
  const canFlushConversationsRef = useRef(false)

  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? conversations[0]
  const activeDocument = openDocuments.find((document) => document.path === activeDocumentPath)
  const hasDirtyDocuments = openDocuments.some(
    (document) => document.content !== document.savedContent
  )
  latestConversationStateRef.current = toPersistedState(conversations, selectedConversationId)
  canFlushConversationsRef.current = canPersistConversations && !isConversationLoading

  useEffect(() => {
    onDirtyChange(hasDirtyDocuments)
  }, [hasDirtyDocuments, onDirtyChange])

  useEffect(() => {
    function protectUnsavedDocuments(event: BeforeUnloadEvent): void {
      if (!hasDirtyDocuments) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', protectUnsavedDocuments)
    return () => window.removeEventListener('beforeunload', protectUnsavedDocuments)
  }, [hasDirtyDocuments])

  useEffect(() => {
    let active = true
    void window.projects
      .listDirectory(project.handle, '')
      .then((entries) => {
        if (active) setEntriesByDirectory({ '': entries })
      })
      .catch((error: unknown) => {
        if (active) setFileError(error instanceof Error ? error.message : '无法读取项目文件')
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
    setIsConversationLoading(true)
    setCanPersistConversations(false)
    setConversationError('')

    setLoadedConversationIds(new Set())
    setLoadingConversationIds(new Set())

    void (async () => {
      try {
        const storedState = await window.projects.loadConversations(project.handle)
        if (!active) return

        if (storedState) {
          const storedConversations = storedState.conversations.map((conversation) => ({
            ...conversation,
            messages: []
          }))
          setConversations(storedConversations)
          setSelectedConversationId(storedState.selectedConversationId)
          lastSavedConversationSnapshotRef.current = JSON.stringify(storedState)
          setLoadingConversationIds(new Set([storedState.selectedConversationId]))

          const messages = await window.projects.loadConversationMessages(
            project.handle,
            storedState.selectedConversationId
          )
          if (!active) return
          setConversations((current) => current.map((conversation) =>
            conversation.id === storedState.selectedConversationId
              ? { ...conversation, messages }
              : conversation
          ))
          setLoadedConversationIds(new Set([storedState.selectedConversationId]))
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
          `${error instanceof Error ? error.message : '无法加载项目会话'}；已停止自动保存以保护原记录`
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

  useEffect(() => {
    if (!canPersistConversations || isConversationLoading) return

    const state = toPersistedState(conversations, selectedConversationId)
    const snapshot = JSON.stringify(state)
    if (snapshot === lastSavedConversationSnapshotRef.current) return

    const timer = window.setTimeout(() => {
      void window.projects
        .saveConversations(project.handle, state)
        .then(() => {
          lastSavedConversationSnapshotRef.current = snapshot
          setConversationError('')
        })
        .catch((error: unknown) => {
          setConversationError(error instanceof Error ? error.message : '无法保存项目会话')
        })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [canPersistConversations, conversations, isConversationLoading, project.handle, selectedConversationId])

  useEffect(() => () => {
    if (!canFlushConversationsRef.current) return

    const state = latestConversationStateRef.current
    const snapshot = JSON.stringify(state)
    if (snapshot === lastSavedConversationSnapshotRef.current) return

    void window.projects.saveConversations(project.handle, state).catch((error: unknown) => {
      console.warn('Unable to flush project conversations:', error)
    })
  }, [project.handle])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [selectedConversation.messages, isSending])

  useEffect(() => window.agent.onStream((event) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === event.conversationId
        ? {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === event.requestId
                ? { ...message, text: `${message.text}${event.delta}` }
                : message
            )
          }
        : conversation
    ))
  }), [])

  function startConversation(): void {
    if (isConversationLoading) return
    setActiveDocumentPath(null)
    const existingDraft = conversations.find((conversation) =>
      loadedConversationIds.has(conversation.id) && conversation.messages.length === 0
    )
    if (existingDraft) {
      setSelectedConversationId(existingDraft.id)
      setDraft('')
      setChatError('')
      return
    }

    const conversation = createConversation()
    setConversations((current) => [conversation, ...current])
    setSelectedConversationId(conversation.id)
    setLoadedConversationIds((current) => new Set(current).add(conversation.id))
    setChatError('')
    setDraft('')
  }

  async function selectConversation(conversationId: string): Promise<void> {
    setActiveDocumentPath(null)
    setSelectedConversationId(conversationId)
    setChatError('')
    if (loadedConversationIds.has(conversationId) || loadingConversationIds.has(conversationId)) {
      return
    }

    setLoadingConversationIds((current) => new Set(current).add(conversationId))
    try {
      const messages = await window.projects.loadConversationMessages(project.handle, conversationId)
      setConversations((current) => current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, messages } : conversation
      ))
      setLoadedConversationIds((current) => new Set(current).add(conversationId))
      setConversationError('')
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : '无法加载 Pi 会话')
    } finally {
      setLoadingConversationIds((current) => {
        const next = new Set(current)
        next.delete(conversationId)
        return next
      })
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
    if (entriesByDirectory[entry.path]) return

    setLoadingPaths((current) => new Set(current).add(entry.path))
    setFileError('')
    try {
      const entries = await window.projects.listDirectory(project.handle, entry.path)
      setEntriesByDirectory((current) => ({ ...current, [entry.path]: entries }))
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
    const existingDocument = openDocuments.find((document) => document.path === entry.path)
    if (existingDocument) {
      setActiveDocumentPath(existingDocument.path)
      setSelectedFilePath(existingDocument.path)
      return
    }
    if (openingFilePaths.has(entry.path)) return

    setOpeningFilePaths((current) => new Set(current).add(entry.path))
    setSelectedFilePath(entry.path)
    setFileError('')
    try {
      const file = await window.projects.readTextFile(project.handle, entry.path)
      const document: OpenTextDocument = {
        ...file,
        name: entry.name,
        savedContent: file.content,
        isSaving: false,
        conflict: false,
        error: '',
        viewMode: file.kind === 'markdown' ? 'split' : 'edit'
      }
      setOpenDocuments((current) =>
        current.some((candidate) => candidate.path === file.path)
          ? current
          : [...current, document]
      )
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

  function updateDocument(path: string, content: string): void {
    setOpenDocuments((current) => current.map((document) =>
      document.path === path ? { ...document, content, error: '' } : document
    ))
  }

  function updateDocumentViewMode(path: string, viewMode: MarkdownViewMode): void {
    setOpenDocuments((current) => current.map((document) =>
      document.path === path ? { ...document, viewMode } : document
    ))
  }

  async function saveDocument(path: string): Promise<void> {
    const document = openDocuments.find((candidate) => candidate.path === path)
    if (
      !document ||
      document.isSaving ||
      document.conflict ||
      document.content === document.savedContent
    ) return

    const savedContent = document.content
    setOpenDocuments((current) => current.map((candidate) =>
      candidate.path === path ? { ...candidate, isSaving: true, error: '' } : candidate
    ))
    try {
      const result = await window.projects.saveTextFile(project.handle, {
        path,
        content: savedContent,
        revision: document.revision,
        hasBom: document.hasBom
      })
      setOpenDocuments((current) => current.map((candidate) => {
        if (candidate.path !== path) return candidate
        if (!result.ok) {
          return {
            ...candidate,
            isSaving: false,
            conflict: true,
            error: '文件已被其他程序修改。重新载入会放弃当前未保存内容。'
          }
        }
        return {
          ...candidate,
          savedContent,
          revision: result.revision,
          isSaving: false,
          conflict: false,
          error: ''
        }
      }))
    } catch (error) {
      setOpenDocuments((current) => current.map((candidate) =>
        candidate.path === path
          ? {
              ...candidate,
              isSaving: false,
              error: error instanceof Error ? error.message : '无法保存文件'
            }
          : candidate
      ))
    }
  }

  async function reloadDocument(path: string): Promise<void> {
    const document = openDocuments.find((candidate) => candidate.path === path)
    if (!document) return
    if (
      document.content !== document.savedContent &&
      !window.confirm(`重新载入 ${document.name}？当前未保存内容将丢失。`)
    ) return

    try {
      const file = await window.projects.readTextFile(project.handle, path)
      setOpenDocuments((current) => current.map((candidate) =>
        candidate.path === path
          ? {
              ...candidate,
              ...file,
              savedContent: file.content,
              isSaving: false,
              conflict: false,
              error: ''
            }
          : candidate
      ))
    } catch (error) {
      setOpenDocuments((current) => current.map((candidate) =>
        candidate.path === path
          ? { ...candidate, error: error instanceof Error ? error.message : '无法重新载入文件' }
          : candidate
      ))
    }
  }

  function closeDocument(path: string): void {
    const documentIndex = openDocuments.findIndex((document) => document.path === path)
    const document = openDocuments[documentIndex]
    if (!document) return
    if (
      document.content !== document.savedContent &&
      !window.confirm(`关闭 ${document.name}？当前未保存内容将丢失。`)
    ) return

    const remaining = openDocuments.filter((candidate) => candidate.path !== path)
    setOpenDocuments(remaining)
    if (activeDocumentPath === path) {
      const nextDocument = remaining[Math.min(documentIndex, remaining.length - 1)]
      setActiveDocumentPath(nextDocument?.path ?? null)
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
    ) return

    const conversationId = selectedConversation.id
    const requestId = crypto.randomUUID()
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: prompt }
    const assistantMessage: ChatMessage = {
      id: requestId,
      role: 'assistant',
      text: '',
      isStreaming: true
    }
    setDraft('')
    setChatError('')
    setIsSending(true)
    setConversations((current) => current.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            title: conversation.messages.length === 0 ? prompt.slice(0, 24) : conversation.title,
            messages: [...conversation.messages, userMessage, assistantMessage]
          }
        : conversation
    ))

    try {
      const result = await window.agent.prompt({
        requestId,
        conversationId,
        projectHandle: project.handle,
        input: prompt
      })
      setConversations((current) => current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === requestId
                  ? { ...message, text: result.text, isStreaming: false }
                  : message
              )
            }
          : conversation
      ))
    } catch (error) {
      setConversations((current) => current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.filter((message) => message.id !== requestId)
            }
          : conversation
      ))
      setChatError(error instanceof Error ? error.message : '暂时无法获取回复')
    } finally {
      setIsSending(false)
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <section className="project-workspace" aria-label={`${project.name} 项目工作区`}>
      <aside className="project-sidebar">
        <section className="conversation-pane" aria-labelledby="conversation-list-title">
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
            >＋</button>
          </header>
          <div className="conversation-list">
            {conversations.map((conversation) => (
                <button
                  className={conversation.id === selectedConversation.id ? 'conversation-item conversation-item-active' : 'conversation-item'}
                  type="button"
                  key={conversation.id}
                  onClick={() => void selectConversation(conversation.id)}
                >
                  <ConversationIcon />
                  <span>{conversation.title}</span>
                </button>
              ))}
          </div>
        </section>

        <section className="file-pane" aria-labelledby="project-files-title">
          <header className="sidebar-section-heading file-heading">
            <div>
              <span>项目内容</span>
              <h2 id="project-files-title">文件</h2>
            </div>
          </header>
          <div className="file-tree-scroll">
            {fileError ? <p className="sidebar-error" role="alert">{fileError}</p> : null}
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
                onOpenFile={(entry) => void openFile(entry)}
                onSelectFile={setSelectedFilePath}
                onToggle={(entry) => void toggleDirectory(entry)}
              />
            )}
          </div>
        </section>
      </aside>

      <section className="workspace-main">
        <header className="workspace-bar">
          <nav className="workspace-tabs" aria-label="打开的内容" role="tablist">
            <button
              className={`workspace-tab workspace-chat-tab${activeDocument ? '' : ' workspace-tab-active'}`}
              type="button"
              role="tab"
              aria-selected={!activeDocument}
              onClick={() => setActiveDocumentPath(null)}
            >
              <ConversationIcon />
              <span>{selectedConversation.title}</span>
            </button>
            {openDocuments.map((document) => {
              const isDirty = document.content !== document.savedContent
              const isActive = document.path === activeDocument?.path
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
                    title={document.path}
                    onClick={() => {
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
                  >×</button>
                </div>
              )
            })}
          </nav>

          {activeDocument ? (
            <div className="workspace-document-actions">
              {activeDocument.kind === 'markdown' ? (
                <div className="workspace-view-switch" aria-label="Markdown 查看方式">
                  {(['edit', 'split', 'preview'] as const).map((mode) => (
                    <button
                      className={activeDocument.viewMode === mode ? 'workspace-view-active' : ''}
                      key={mode}
                      type="button"
                      aria-pressed={activeDocument.viewMode === mode}
                      onClick={() => updateDocumentViewMode(activeDocument.path, mode)}
                    >
                      {mode === 'edit' ? '编辑' : mode === 'split' ? '分栏' : '预览'}
                    </button>
                  ))}
                </div>
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
              >保存</button>
            </div>
          ) : null}
        </header>

        {activeDocument ? (
          <DocumentEditor
            key={activeDocument.path}
            document={activeDocument}
            onChange={(content) => updateDocument(activeDocument.path, content)}
            onReload={() => void reloadDocument(activeDocument.path)}
            onSave={() => void saveDocument(activeDocument.path)}
            projectHandle={project.handle}
          />
        ) : (
          <section className="chat-panel" aria-labelledby="active-conversation-title">
            <h1 id="active-conversation-title" className="sr-only">
              {selectedConversation.title}
            </h1>

            <div className="message-stream" aria-live="polite">
              {loadingConversationIds.has(selectedConversation.id) ? (
                <p className="sidebar-loading">正在加载 Pi 会话…</p>
              ) : selectedConversation.messages.length === 0 ? (
                <div className="chat-empty">
                  <span className="chat-empty-mark" aria-hidden="true"><i /><i /><i /></span>
                  <h2>从项目材料开始思考</h2>
                  <p>描述你的演示目标、受众或手头的问题，SlideMind 会和你一起梳理叙事。</p>
                </div>
              ) : (
                <div className="message-list">
                  {selectedConversation.messages.map((message) => (
                    <article
                      className={`chat-message chat-message-${message.role}${message.isStreaming && !message.text ? ' chat-message-loading' : ''}${message.isStreaming && message.text ? ' chat-message-streaming' : ''}`}
                      key={message.id}
                    >
                      <span>{message.role === 'user' ? '你' : 'SM'}</span>
                      {message.isStreaming && !message.text ? (
                        <p><i /><i /><i /></p>
                      ) : (
                        <p>{message.text}</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <div ref={messageEndRef} />
            </div>

            <form className="chat-composer" onSubmit={(event) => void sendMessage(event)}>
              {conversationError ? <p className="composer-error" role="alert">{conversationError}</p> : null}
              {chatError ? <p className="composer-error" role="alert">{chatError}</p> : null}
              <div className="composer-box">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="输入消息，和 SlideMind 一起梳理演示…"
                  rows={2}
                  disabled={isSending || isConversationLoading || loadingConversationIds.has(selectedConversation.id)}
                  aria-label="对话消息"
                />
                <div className="composer-footer">
                  <span>Enter 发送 · Shift Enter 换行</span>
                  <div className="composer-actions">
                    <AgentModelSelect disabled={isSending || isConversationLoading || loadingConversationIds.has(selectedConversation.id)} />
                    <button className="composer-send" type="submit" disabled={!draft.trim() || isSending || isConversationLoading || loadingConversationIds.has(selectedConversation.id)} aria-label="发送消息">↑</button>
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
