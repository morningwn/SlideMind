import { lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

export const PROJECT_STORAGE_DIRECTORY = '.slideMind'
export const PI_CONVERSATIONS_DIRECTORY = 'convs'

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  return (
    candidatePath === projectPath ||
    candidatePath.startsWith(`${projectPath}${sep}`)
  )
}

async function resolveDirectory(
  projectPath: string,
  directoryPath: string,
  label: string,
  create: boolean,
): Promise<string | null> {
  try {
    const stats = await lstat(directoryPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`${label}无效`)
    }
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw error
    if (!create) return null

    try {
      await mkdir(directoryPath, { mode: 0o700 })
    } catch (mkdirError) {
      const mkdirCode =
        mkdirError instanceof Error && 'code' in mkdirError
          ? mkdirError.code
          : undefined
      if (mkdirCode !== 'EEXIST') throw mkdirError
    }

    const stats = await lstat(directoryPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`${label}无效`)
    }
  }

  const canonicalPath = await realpath(directoryPath)
  if (!isInsideProject(projectPath, canonicalPath)) {
    throw new Error(`${label}超出项目范围`)
  }
  return canonicalPath
}

export async function resolveProjectStorageDirectory(
  projectPath: string,
  create: boolean,
): Promise<string | null> {
  return resolveDirectory(
    projectPath,
    join(projectPath, PROJECT_STORAGE_DIRECTORY),
    '项目会话存储目录',
    create,
  )
}

export async function resolvePiConversationsDirectory(
  projectPath: string,
  create: boolean,
): Promise<string | null> {
  const storagePath = await resolveProjectStorageDirectory(projectPath, create)
  if (!storagePath) return null

  return resolveDirectory(
    projectPath,
    join(storagePath, PI_CONVERSATIONS_DIRECTORY),
    'Pi 会话存储目录',
    create,
  )
}

export async function resolveSafePiSessionFile(
  conversationsDirectory: string,
  sessionPath: string,
): Promise<string> {
  const stats = await lstat(sessionPath)
  if (stats.isSymbolicLink() || !stats.isFile())
    throw new Error('Pi 会话记录文件无效')

  const canonicalPath = await realpath(sessionPath)
  if (!canonicalPath.startsWith(`${conversationsDirectory}${sep}`)) {
    throw new Error('Pi 会话记录文件超出项目范围')
  }
  return canonicalPath
}

export async function findPiSessionFile(
  conversationsDirectory: string,
  conversationId: string,
): Promise<string | null> {
  const matches = (
    await readdir(conversationsDirectory, { withFileTypes: true })
  ).filter((entry) => {
    const separatorIndex = entry.name.indexOf('_')
    return (
      separatorIndex > 0 &&
      entry.name.endsWith('.jsonl') &&
      entry.name.slice(separatorIndex + 1, -'.jsonl'.length) === conversationId
    )
  })

  if (matches.length > 1) throw new Error('项目中存在重复的 Pi 会话记录')
  if (matches.length === 0) return null
  if (!matches[0].isFile() || matches[0].isSymbolicLink()) {
    throw new Error('Pi 会话记录文件无效')
  }

  return resolveSafePiSessionFile(
    conversationsDirectory,
    join(conversationsDirectory, matches[0].name),
  )
}
