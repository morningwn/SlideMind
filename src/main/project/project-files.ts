import { readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { ProjectFileEntry } from '../../shared/project'

const MAX_DIRECTORY_ENTRIES = 250
const INTERNAL_PROJECT_DIRECTORY = '.slideMind'

function validatePathInput(value: unknown, label: string, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    value.length > 4096 ||
    value.includes('\0')
  ) {
    throw new Error(`${label}无效`)
  }

  return value
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return candidatePath === projectPath || candidatePath.startsWith(`${projectPath}${sep}`)
}

export async function listProjectDirectory(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<ProjectFileEntry[]> {
  const projectPath = await realpath(validatePathInput(projectPathInput, '项目路径'))
  const relativePath = validatePathInput(relativePathInput, '目录路径', true)

  if (isAbsolute(relativePath)) throw new Error('目录路径无效')

  const targetPath = await realpath(resolve(projectPath, relativePath))
  if (!isInsideProject(projectPath, targetPath)) throw new Error('目录路径超出项目范围')

  const targetStats = await stat(targetPath)
  if (!targetStats.isDirectory()) throw new Error('目标不是文件夹')

  const entries = await readdir(targetPath, { withFileTypes: true })
  return entries
    .filter((entry) => relativePath !== '' || entry.name !== INTERNAL_PROJECT_DIRECTORY)
    .sort((left, right) => {
      const kindOrder = Number(right.isDirectory()) - Number(left.isDirectory())
      return kindOrder || left.name.localeCompare(right.name, 'zh-CN')
    })
    .slice(0, MAX_DIRECTORY_ENTRIES)
    .map((entry) => ({
      kind: entry.isDirectory() ? 'directory' : 'file',
      name: entry.name,
      path: relative(projectPath, resolve(targetPath, entry.name))
    }))
}
