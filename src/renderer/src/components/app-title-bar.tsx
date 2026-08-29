import type { ChangeEvent } from 'react'
import appIcon from '../../../../assets/icon.png'
import type { ProjectInfo } from '../../../shared/project'

const CHOOSE_PROJECT_VALUE = '__choose-project__'

interface AppTitleBarProps {
  activeProject: ProjectInfo | null
  isOpeningProject: boolean
  onChooseProject: () => void
  onOpenProject: (project: ProjectInfo) => void
  platform: string
  recentProjects: ProjectInfo[]
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.5 6 3.5 3.5L11.5 6" />
    </svg>
  )
}

export function AppTitleBar({
  activeProject,
  isOpeningProject,
  onChooseProject,
  onOpenProject,
  platform,
  recentProjects
}: AppTitleBarProps): React.JSX.Element {
  function changeProject(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.currentTarget.value
    if (value === CHOOSE_PROJECT_VALUE) {
      onChooseProject()
      return
    }

    const project = recentProjects.find((candidate) => candidate.path === value)
    if (project && project.path !== activeProject?.path) onOpenProject(project)
  }

  return (
    <header className={`app-title-bar app-title-bar-${platform}`}>
      <div className="title-bar-identity">
        <img className="title-bar-icon" src={appIcon} alt="SlideMind" draggable={false} />
        {activeProject ? (
          <label className="title-bar-project" title={activeProject.path}>
            <span className="sr-only">切换项目</span>
            <select
              aria-label="切换项目"
              disabled={isOpeningProject}
              value={activeProject.path}
              onChange={changeProject}
            >
              {recentProjects.map((project) => (
                <option value={project.path} key={project.path}>{project.name}</option>
              ))}
              <option value={CHOOSE_PROJECT_VALUE}>选择其他项目…</option>
            </select>
            <ChevronIcon />
          </label>
        ) : null}
      </div>
    </header>
  )
}
