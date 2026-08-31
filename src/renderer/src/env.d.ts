/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

import type { AgentApi } from '../../shared/agent'
import type { DesktopApi } from '../../shared/desktop'
import type { PresentationApi } from '../../shared/presentation'
import type { ProjectApi } from '../../shared/project'
import type { ProjectVersionApi } from '../../shared/project-version'

export {}

declare global {
  interface Window {
    desktop: Readonly<DesktopApi>
    agent: Readonly<AgentApi>
    presentations: Readonly<PresentationApi>
    projects: Readonly<ProjectApi>
    projectVersions: Readonly<ProjectVersionApi>
  }
}
