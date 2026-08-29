import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type { ProjectInfo } from '../../shared/project'

const projectColors = ['#6f7cff', '#d59a32', '#48ad87', '#bd62c9', '#31a6bc', '#d8628c']

function projectColor(path: string): string {
  let hash = 0
  for (const character of path) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return projectColors[Math.abs(hash) % projectColors.length]
}

function projectInitial(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase() || 'SM'
}

function formatLastOpened(value: string): string {
  const elapsed = Date.now() - Date.parse(value)
  const minutes = Math.max(0, Math.floor(elapsed / 60_000))
  if (minutes < 1) return '刚刚打开'
  if (minutes < 60) return `${minutes} 分钟前打开`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前打开`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前打开`

  return `${new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))}打开`
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h6l1.7 2h9.3v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M3.5 8V6a2 2 0 0 1 2-2h3l2 2h8a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function ClockIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

function App(): React.JSX.Element {
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([])
  const [activeProject, setActiveProject] = useState<ProjectInfo | null>(null)
  const [query, setQuery] = useState('')
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [openingProject, setOpeningProject] = useState<string | null>(null)
  const [projectError, setProjectError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true

    void window.projects
      .listRecent()
      .then((projects) => {
        if (active) setRecentProjects(projects)
      })
      .catch((error: unknown) => {
        if (active) setProjectError(error instanceof Error ? error.message : '无法读取最近项目')
      })
      .finally(() => {
        if (active) setIsLoadingProjects(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      const shortcutModifier = window.desktop.platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (shortcutModifier && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        if (!activeProject && !openingProject) void chooseProject()
      }

      if (shortcutModifier && event.key.toLowerCase() === 'k' && !activeProject) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [activeProject, openingProject])

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return recentProjects
    return recentProjects.filter((project) =>
      `${project.name}\n${project.path}`.toLocaleLowerCase().includes(normalizedQuery)
    )
  }, [query, recentProjects])

  async function chooseProject(): Promise<void> {
    setOpeningProject('picker')
    setProjectError('')
    try {
      const project = await window.projects.chooseFolder()
      if (project) {
        rememberProject(project)
        setActiveProject(project)
      }
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '无法打开项目')
    } finally {
      setOpeningProject(null)
    }
  }

  async function openProject(project: ProjectInfo): Promise<void> {
    setOpeningProject(project.path)
    setProjectError('')
    try {
      const openedProject = await window.projects.open(project.path)
      rememberProject(openedProject)
      setActiveProject(openedProject)
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '无法打开项目')
    } finally {
      setOpeningProject(null)
    }
  }

  async function removeRecentProject(project: ProjectInfo): Promise<void> {
    setProjectError('')
    try {
      setRecentProjects(await window.projects.removeRecent(project.path))
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '无法移除项目记录')
    }
  }

  function rememberProject(project: ProjectInfo): void {
    setRecentProjects((projects) => [
      project,
      ...projects.filter((candidate) => candidate.path !== project.path)
    ].slice(0, 20))
  }

  return (
    <main className="app-shell">
      {activeProject ? (
        <section className="workspace" aria-labelledby="workspace-title">
          <div className="workspace-heading">
            <p>当前项目</p>
            <h1 id="workspace-title">{activeProject.name}</h1>
            <span>{activeProject.path}</span>
          </div>
          <div className="workspace-canvas">
            <span className="canvas-mark" aria-hidden="true"><span /></span>
            <h2>项目已打开</h2>
            <p>演示文稿编辑器将在这个工作区中继续构建。</p>
          </div>
        </section>
      ) : (
        <section className="home" aria-labelledby="recent-title">
          <div className="home-toolbar">
            <label className="project-search">
              <SearchIcon />
              <span className="sr-only">搜索项目</span>
              <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" autoComplete="off" />
              <kbd>{window.desktop.platform === 'darwin' ? '⌘K' : 'Ctrl K'}</kbd>
            </label>
            <button className="open-project-action" type="button" onClick={() => void chooseProject()} disabled={openingProject !== null}>
              <FolderIcon />
              {openingProject === 'picker' ? '正在选择…' : '选择项目'}
            </button>
          </div>

          <div className="recent-heading">
            <h1 id="recent-title">最近项目</h1>
            {!isLoadingProjects && recentProjects.length > 0 ? <span>{recentProjects.length} 个项目</span> : null}
          </div>

          {projectError ? (
            <div className="project-error" role="alert">
              <span>{projectError}</span>
              <button type="button" onClick={() => setProjectError('')}>关闭</button>
            </div>
          ) : null}

          {isLoadingProjects ? (
            <div className="project-list" aria-label="正在加载最近项目">
              {[0, 1, 2].map((item) => <span className="project-skeleton" key={item} />)}
            </div>
          ) : filteredProjects.length > 0 ? (
            <div className="project-list">
              {filteredProjects.map((project) => {
                const isOpening = openingProject === project.path
                const style = { '--project-color': projectColor(project.path) } as CSSProperties
                return (
                  <article className="project-item" key={project.path} style={style}>
                    <button className="project-open" type="button" onClick={() => void openProject(project)} disabled={openingProject !== null}>
                      <span className="project-mark" aria-hidden="true"><span>{projectInitial(project.name)}</span></span>
                      <span className="project-copy">
                        <strong>{project.name}</strong>
                        <small title={project.path}>{project.path}</small>
                        <span className="project-time">
                          <ClockIcon />
                          {isOpening ? '正在打开…' : formatLastOpened(project.lastOpenedAt)}
                        </span>
                      </span>
                      <span className="open-arrow" aria-hidden="true">→</span>
                    </button>
                    <button className="remove-project" type="button" onClick={() => void removeRecentProject(project)} aria-label={`从最近项目中移除 ${project.name}`} title="移除记录">×</button>
                  </article>
                )
              })}
            </div>
          ) : query ? (
            <div className="empty-state compact-empty">
              <h2>没有匹配的项目</h2>
              <p>换一个项目名称或路径试试。</p>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-mark" aria-hidden="true"><span /></span>
              <h2>从一个项目开始</h2>
              <p>选择包含演示材料的文件夹，它会出现在最近项目中。</p>
              <button type="button" onClick={() => void chooseProject()}><FolderIcon />选择项目</button>
            </div>
          )}
        </section>
      )}

    </main>
  )
}

export default App
