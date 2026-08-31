import { lstat, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ProjectFileEntry, RenameProjectFileInput } from '../../shared/project'

const MAX_DIRECTORY_ENTRIES = 250
const INTERNAL_PROJECT_DIRECTORIES = new Set(['.git', '.slidemind'])

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

function hasInternalSegment(path: string): boolean {
  return path
    .split(sep)
    .some((segment) => INTERNAL_PROJECT_DIRECTORIES.has(segment.toLocaleLowerCase()))
}

function normalizeRenameInput(value: unknown): RenameProjectFileInput {
  if (!value || typeof value !== 'object') throw new Error('文件重命名参数无效')
  const input = value as Partial<RenameProjectFileInput>
  const path = validatePathInput(input.path, '文件路径')
  const name = validatePathInput(input.name, '新文件名')
  if (
    name !== name.trim() ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.length > 255 ||
    INTERNAL_PROJECT_DIRECTORIES.has(name.toLocaleLowerCase())
  ) {
    throw new Error('新文件名无效')
  }
  return { path, name }
}

export function projectFileRenamePaths(inputValue: unknown): {
  input: RenameProjectFileInput
  paths: [string, string]
} {
  const input = normalizeRenameInput(inputValue)
  return {
    input,
    paths: [input.path, join(dirname(input.path), input.name)]
  }
}

async function resolveRegularProjectFile(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<{ relativePath: string; targetPath: string }> {
  const projectPath = await realpath(validatePathInput(projectPathInput, '项目路径'))
  const relativePath = validatePathInput(relativePathInput, '文件路径')
  if (isAbsolute(relativePath)) throw new Error('文件路径无效')

  const lexicalTarget = resolve(projectPath, relativePath)
  if (!isInsideProject(projectPath, lexicalTarget)) throw new Error('文件路径超出项目范围')
  const normalizedRelativePath = relative(projectPath, lexicalTarget)
  if (hasInternalSegment(normalizedRelativePath)) throw new Error('不能操作项目内部文件')

  let currentPath = projectPath
  for (const segment of normalizedRelativePath.split(sep)) {
    currentPath = resolve(currentPath, segment)
    if ((await lstat(currentPath)).isSymbolicLink()) throw new Error('不能操作符号链接文件')
  }

  const targetPath = await realpath(lexicalTarget)
  if (!isInsideProject(projectPath, targetPath)) throw new Error('文件路径超出项目范围')
  if (!(await lstat(targetPath)).isFile()) throw new Error('目标不是普通文件')
  return { relativePath: normalizedRelativePath, targetPath }
}

export async function listProjectDirectory(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<ProjectFileEntry[]> {
  const projectPath = await realpath(validatePathInput(projectPathInput, '项目路径'))
  const relativePath = validatePathInput(relativePathInput, '目录路径', true)

  if (isAbsolute(relativePath)) throw new Error('目录路径无效')

  const lexicalTarget = resolve(projectPath, relativePath)
  const normalizedRelativePath = relative(projectPath, lexicalTarget)
  if (hasInternalSegment(normalizedRelativePath)) throw new Error('不能读取项目内部目录')
  const targetPath = await realpath(lexicalTarget)
  if (!isInsideProject(projectPath, targetPath)) throw new Error('目录路径超出项目范围')

  const targetStats = await stat(targetPath)
  if (!targetStats.isDirectory()) throw new Error('目标不是文件夹')

  const entries = await readdir(targetPath, { withFileTypes: true })
  return entries
    .filter((entry) => normalizedRelativePath !== '' || !hasInternalSegment(entry.name))
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

export async function renameProjectFile(
  projectPathInput: unknown,
  inputValue: unknown
): Promise<ProjectFileEntry> {
  const input = normalizeRenameInput(inputValue)
  const source = await resolveRegularProjectFile(projectPathInput, input.path)
  if (input.name === source.relativePath.split(sep).at(-1)) {
    return { kind: 'file', name: input.name, path: source.relativePath }
  }

  const destinationPath = resolve(dirname(source.targetPath), input.name)
  const destinationRelativePath = join(dirname(source.relativePath), input.name)
  try {
    const existing = await lstat(destinationPath)
    const existingPath = await realpath(destinationPath)
    if (existing.isSymbolicLink() || existingPath !== source.targetPath) {
      throw new Error('同名文件已存在')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await rename(source.targetPath, destinationPath)
  return { kind: 'file', name: input.name, path: destinationRelativePath }
}

export async function deleteProjectFile(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<void> {
  const source = await resolveRegularProjectFile(projectPathInput, relativePathInput)
  await unlink(source.targetPath)
}
