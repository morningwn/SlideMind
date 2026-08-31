import { join } from 'node:path'

export function resolveBundledSkillsDirectory(options: {
  appPath: string
  isPackaged: boolean
  resourcesPath: string
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, 'skills')
    : join(options.appPath, 'skills')
}
