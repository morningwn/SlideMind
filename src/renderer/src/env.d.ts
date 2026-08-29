/// <reference types="vite/client" />

import type { AgentApi } from '../../shared/agent'

export {}

declare global {
  interface DesktopApi {
    platform: string
    versions: Readonly<{
      electron: string
      chrome: string
      node: string
    }>
  }

  interface Window {
    desktop: Readonly<DesktopApi>
    agent: Readonly<AgentApi>
  }
}
