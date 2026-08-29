/// <reference types="vite/client" />

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
}
