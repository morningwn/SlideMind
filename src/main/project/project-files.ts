import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ProjectFileEntry, RenameProjectFileInput } from '../../shared/project'

const MAX_DIRECTORY_ENTRIES = 250
const MAX_REFERENCE_FILES = 5_000
const MAX_VERSIONED_DIRECTORY_FILES = 10_000
const INTERNAL_PROJECT_DIRECTORIES = new Set(['.git', '.slidemind'])
const VERSION_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.slidemind',
  'coverage',
  'node_modules',
  'out',
  'release-dist'
])

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
  if (!value || typeof value !== 'object') throw new Error('重命名参数无效')
  const input = value as Partial<RenameProjectFileInput>
  const path = validatePathInput(input.path, '文件路径')
  const name = validatePathInput(input.name, '新名称')
  if (
    name !== name.trim() ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.length > 255 ||
    INTERNAL_PROJECT_DIRECTORIES.has(name.toLocaleLowerCase())
  ) {
    throw new Error('新名称无效')
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

export async function resolveRegularProjectFile(
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

async function resolveRegularProjectDirectory(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<{ relativePath: string; targetPath: string }> {
  const projectPath = await realpath(validatePathInput(projectPathInput, '项目路径'))
  const relativePath = validatePathInput(relativePathInput, '目录路径')
  if (isAbsolute(relativePath)) throw new Error('目录路径无效')

  const lexicalTarget = resolve(projectPath, relativePath)
  if (!isInsideProject(projectPath, lexicalTarget) || lexicalTarget === projectPath) {
    throw new Error('目录路径超出项目范围')
  }
  const normalizedRelativePath = relative(projectPath, lexicalTarget)
  if (hasInternalSegment(normalizedRelativePath)) throw new Error('不能操作项目内部目录')

  let currentPath = projectPath
  for (const segment of normalizedRelativePath.split(sep)) {
    currentPath = resolve(currentPath, segment)
    if ((await lstat(currentPath)).isSymbolicLink()) throw new Error('不能操作符号链接目录')
  }

  const targetPath = await realpath(lexicalTarget)
  if (!isInsideProject(projectPath, targetPath) || targetPath === projectPath) {
    throw new Error('目录路径超出项目范围')
  }
  if (!(await lstat(targetPath)).isDirectory()) throw new Error('目标不是文件夹')
  return { relativePath: normalizedRelativePath, targetPath }
}

async function resolveNewProjectEntry(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<{ relativePath: string; targetPath: string }> {
  const projectPath = await realpath(validatePathInput(projectPathInput, '项目路径'))
  const relativePath = validatePathInput(relativePathInput, '新建路径')
  if (isAbsolute(relativePath)) throw new Error('新建路径无效')

  const targetPath = resolve(projectPath, relativePath)
  if (!isInsideProject(projectPath, targetPath) || targetPath === projectPath) {
    throw new Error('新建路径超出项目范围')
  }
  const normalizedRelativePath = relative(projectPath, targetPath)
  if (hasInternalSegment(normalizedRelativePath)) throw new Error('不能在项目内部目录中创建')

  const parentRelativePath = relative(projectPath, dirname(targetPath))
  let currentPath = projectPath
  for (const segment of parentRelativePath ? parentRelativePath.split(sep) : []) {
    currentPath = resolve(currentPath, segment)
    const stats = await lstat(currentPath)
    if (stats.isSymbolicLink()) throw new Error('不能通过符号链接目录创建')
    if (!stats.isDirectory()) throw new Error('新建位置不是文件夹')
  }

  try {
    await lstat(targetPath)
    throw new Error('同名文件或文件夹已存在')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { relativePath: normalizedRelativePath, targetPath }
}

async function collectVersionedDirectoryFiles(
  targetPath: string,
  relativePath: string
): Promise<string[]> {
  if (relativePath
    .split(sep)
    .some((segment) => VERSION_EXCLUDED_DIRECTORIES.has(segment.toLocaleLowerCase()))) {
    return []
  }
  const paths: string[] = []
  const visit = async (directoryPath: string, directoryRelativePath: string): Promise<void> => {
    const entries = (await readdir(directoryPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const entryPath = resolve(directoryPath, entry.name)
      const entryRelativePath = join(directoryRelativePath, entry.name)
      if (entry.isDirectory()) {
        if (VERSION_EXCLUDED_DIRECTORIES.has(entry.name.toLocaleLowerCase())) continue
        await visit(entryPath, entryRelativePath)
      } else if (entry.isFile()) {
        paths.push(entryRelativePath)
        if (paths.length > MAX_VERSIONED_DIRECTORY_FILES) {
          throw new Error('文件夹包含过多文件，无法安全记录本次操作')
        }
      }
    }
  }
  await visit(targetPath, relativePath)
  return paths
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

export async function listProjectFiles(projectPathInput: unknown): Promise<ProjectFileEntry[]> {
  const projectPath = await realpath(validatePathInput(projectPathInput, '项目路径'))
  const files: ProjectFileEntry[] = []

  const visit = async (directoryPath: string): Promise<void> => {
    const entries = (await readdir(directoryPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    for (const entry of entries) {
      if (files.length >= MAX_REFERENCE_FILES || entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (VERSION_EXCLUDED_DIRECTORIES.has(entry.name.toLocaleLowerCase())) continue
        await visit(resolve(directoryPath, entry.name))
      } else if (entry.isFile()) {
        const path = relative(projectPath, resolve(directoryPath, entry.name))
        if (hasInternalSegment(path)) continue
        files.push({ kind: 'file', name: entry.name, path })
      }
    }
  }

  await visit(projectPath)
  return files
}

export async function createProjectDirectory(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<ProjectFileEntry> {
  const target = await resolveNewProjectEntry(projectPathInput, relativePathInput)
  try {
    await mkdir(target.targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('同名文件或文件夹已存在')
    }
    throw error
  }
  return {
    kind: 'directory',
    name: target.relativePath.split(sep).at(-1)!,
    path: target.relativePath
  }
}

export async function createProjectMarkdownFile(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<ProjectFileEntry> {
  const target = await resolveNewProjectEntry(projectPathInput, relativePathInput)
  if (!['.md', '.markdown'].includes(extname(target.relativePath).toLocaleLowerCase())) {
    throw new Error('Markdown 文件必须使用 .md 或 .markdown 扩展名')
  }
  try {
    await writeFile(target.targetPath, '# 未命名文档\n', { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('同名文件或文件夹已存在')
    }
    throw error
  }
  return {
    kind: 'file',
    name: target.relativePath.split(sep).at(-1)!,
    path: target.relativePath
  }
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

export async function projectDirectoryRenamePaths(
  projectPathInput: unknown,
  inputValue: unknown
): Promise<{ input: RenameProjectFileInput; paths: string[] }> {
  const input = normalizeRenameInput(inputValue)
  const source = await resolveRegularProjectDirectory(projectPathInput, input.path)
  const destinationRelativePath = join(dirname(source.relativePath), input.name)
  const sourcePaths = await collectVersionedDirectoryFiles(
    source.targetPath,
    source.relativePath
  )
  return {
    input,
    paths: [
      ...sourcePaths,
      ...sourcePaths.map((path) => join(
        destinationRelativePath,
        relative(source.relativePath, path)
      ))
    ]
  }
}

export async function renameProjectDirectory(
  projectPathInput: unknown,
  inputValue: unknown
): Promise<ProjectFileEntry> {
  const input = normalizeRenameInput(inputValue)
  const source = await resolveRegularProjectDirectory(projectPathInput, input.path)
  if (input.name === source.relativePath.split(sep).at(-1)) {
    return { kind: 'directory', name: input.name, path: source.relativePath }
  }

  const destinationPath = resolve(dirname(source.targetPath), input.name)
  const destinationRelativePath = join(dirname(source.relativePath), input.name)
  try {
    const existing = await lstat(destinationPath)
    const existingPath = await realpath(destinationPath)
    if (existing.isSymbolicLink() || existingPath !== source.targetPath) {
      throw new Error('同名文件夹已存在')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await rename(source.targetPath, destinationPath)
  return { kind: 'directory', name: input.name, path: destinationRelativePath }
}

export async function projectDirectoryDeletePaths(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<{ path: string; paths: string[] }> {
  const source = await resolveRegularProjectDirectory(projectPathInput, relativePathInput)
  return {
    path: source.relativePath,
    paths: await collectVersionedDirectoryFiles(source.targetPath, source.relativePath)
  }
}

export async function deleteProjectDirectory(
  projectPathInput: unknown,
  relativePathInput: unknown
): Promise<void> {
  const source = await resolveRegularProjectDirectory(projectPathInput, relativePathInput)
  await rm(source.targetPath, { recursive: true })
}
