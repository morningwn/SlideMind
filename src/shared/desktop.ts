export type DesktopCloseResponse = 'keep-window-open' | 'exit-application'

export interface DesktopApi {
  platform: string
  versions: Readonly<{
    electron: string
    chrome: string
    node: string
  }>
  onCloseRequested(listener: () => void): () => void
  resolveCloseRequest(response: DesktopCloseResponse): Promise<boolean>
}
