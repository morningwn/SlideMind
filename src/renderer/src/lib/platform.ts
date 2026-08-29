export function getPlatformLabel(platform: string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  return 'Desktop'
}
