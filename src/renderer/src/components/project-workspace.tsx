import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import type { ProjectFileEntry, ProjectInfo } from '../../../shared/project'
import { AgentModelSelect } from './agent-model-select'

interface ChatMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
  isStreaming?: boolean
}

interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
}

interface ProjectWorkspaceProps {
  project: ProjectInfo
}

interface FileTreeLevelProps {
  directoryPath: string
  depth: number
  entriesByDirectory: Readonly<Record<string, ProjectFileEntry[]>>
  expandedPaths: ReadonlySet<string>
  loadingPaths: ReadonlySet<string>
  onToggle: (entry: ProjectFileEntry) => void
}

function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: '新对话',
    messages: []
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
              className={`file-tree-item ${isDirectory ? 'file-tree-directory' : ''}`}
              style={{ '--tree-depth': depth } as React.CSSProperties}
              type="button"
              role="treeitem"
              aria-expanded={isDirectory ? isExpanded : undefined}
              onClick={() => {
                if (isDirectory) onToggle(entry)
              }}
              tabIndex={isDirectory ? 0 : -1}
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
                onToggle={onToggle}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function ProjectWorkspace({ project }: ProjectWorkspaceProps): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(() => [createConversation()])
  const [selectedConversationId, setSelectedConversationId] = useState(() => conversations[0].id)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, ProjectFileEntry[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set(['']))
  const [fileError, setFileError] = useState('')
  const messageEndRef = useRef<HTMLDivElement>(null)

  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? conversations[0]

  useEffect(() => {
    let active = true
    void window.projects
      .listDirectory(project.path, '')
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
  }, [project.path])

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
    const conversation = createConversation()
    setConversations((current) => [conversation, ...current])
    setSelectedConversationId(conversation.id)
    setChatError('')
    setDraft('')
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
      const entries = await window.projects.listDirectory(project.path, entry.path)
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

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt || isSending) return

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
        projectPath: project.path,
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
            <button type="button" onClick={startConversation} aria-label="新建对话" title="新建对话">＋</button>
          </header>
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                className={conversation.id === selectedConversation.id ? 'conversation-item conversation-item-active' : 'conversation-item'}
                type="button"
                key={conversation.id}
                onClick={() => setSelectedConversationId(conversation.id)}
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
                onToggle={(entry) => void toggleDirectory(entry)}
              />
            )}
          </div>
        </section>
      </aside>

      <section className="chat-panel" aria-labelledby="active-conversation-title">
        <header className="chat-heading">
          <div>
            <h1 id="active-conversation-title">{selectedConversation.title}</h1>
            <span>{project.name}</span>
          </div>
        </header>

        <div className="message-stream" aria-live="polite">
          {selectedConversation.messages.length === 0 ? (
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
          {chatError ? <p className="composer-error" role="alert">{chatError}</p> : null}
          <div className="composer-box">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="输入消息，和 SlideMind 一起梳理演示…"
              rows={2}
              disabled={isSending}
              aria-label="对话消息"
            />
            <div className="composer-footer">
              <span>Enter 发送 · Shift Enter 换行</span>
              <div className="composer-actions">
                <AgentModelSelect disabled={isSending} />
                <button className="composer-send" type="submit" disabled={!draft.trim() || isSending} aria-label="发送消息">↑</button>
              </div>
            </div>
          </div>
        </form>
      </section>
    </section>
  )
}
