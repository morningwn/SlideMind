import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

export class FilePermissionError extends Error {}
export type FileAccess = 'read' | 'write'
const PROTECTED = new Set([
  '.git',
  '.slidemind',
  'node_modules',
  'out',
  'coverage',
  'release-dist',
  '.ssh',
  '.aws',
  '.gnupg',
])
const CREDENTIALS = new Set([
  'auth.json',
  'credentials.json',
  'application_default_credentials.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.netrc',
])
export const MAX_AGENT_FILE_BYTES = 20 * 1024 * 1024

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  )
}

export class FilePolicy {
  private constructor(
    readonly projectRoot: string,
    readonly readOnlyRoots: readonly string[],
    private readonly aliases: readonly { path: string; root: string }[],
  ) {}

  static async create(
    projectPath: string,
    readOnlyDirectories: readonly string[] = [],
  ): Promise<FilePolicy> {
    const paths = [projectPath, ...readOnlyDirectories]
    const roots = await Promise.all(paths.map((path) => realpath(path)))
    const aliases = paths
      .map((path, index) =>
        Object.freeze({ path: resolve(path), root: roots[index] }),
      )
      .sort((a, b) => b.path.length - a.path.length)
    const policy = new FilePolicy(
      roots[0],
      Object.freeze(roots.slice(1)),
      Object.freeze(aliases),
    )
    Object.freeze(policy)
    return policy
  }

  async resolve(
    input: unknown,
    access: FileAccess,
    kind: 'file' | 'directory' | 'either' = 'file',
    allowMissing = false,
  ): Promise<string> {
    if (
      typeof input !== 'string' ||
      !input.trim() ||
      input.length > 4096 ||
      input.includes('\0') ||
      (process.platform !== 'win32' && input.includes('\\'))
    )
      throw new FilePermissionError('文件路径无效')
    let target = resolve(this.projectRoot, input)
    const alias = this.aliases.find((entry) => inside(entry.path, target))
    if (alias) target = resolve(alias.root, relative(alias.path, target))
    const readOnlyRoot = this.readOnlyRoots.find((root) => inside(root, target))
    if (access === 'write' && readOnlyRoot)
      throw new FilePermissionError('内置资源只允许读取')
    const root =
      readOnlyRoot ??
      (inside(this.projectRoot, target) ? this.projectRoot : undefined)
    if (!root) throw new FilePermissionError('文件路径超出允许范围')
    const parts = relative(root, target).split(sep).filter(Boolean)
    if (
      parts.some(
        (part) =>
          PROTECTED.has(part.toLowerCase()) ||
          (access === 'write' && part.toLowerCase() === '.pi') ||
          /[\x00-\x1f:]/.test(part) ||
          (process.platform === 'win32' && /[. ]$/.test(part)),
      )
    )
      throw new FilePermissionError('不能访问受保护目录或特殊路径')
    const name = basename(target).toLowerCase()
    if (
      name === '.env' ||
      name.startsWith('.env.') ||
      CREDENTIALS.has(name) ||
      /\.(pem|key|p12|pfx)$/.test(name)
    )
      throw new FilePermissionError('不能访问凭据文件')
    let current = root
    for (let index = 0; index <= parts.length; index++) {
      if (index) current = resolve(current, parts[index - 1])
      let stats
      try {
        stats = await lstat(current)
      } catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT')
          return target
        throw error
      }
      if (stats.isSymbolicLink())
        throw new FilePermissionError('不能通过符号链接访问文件')
      const last = index === parts.length
      if (!last && !stats.isDirectory())
        throw new FilePermissionError('父路径不是目录')
      if (
        last &&
        (kind === 'file'
          ? !stats.isFile()
          : kind === 'directory'
            ? !stats.isDirectory()
            : !stats.isFile() && !stats.isDirectory())
      )
        throw new FilePermissionError('目标文件类型不受支持')
      if (stats.isFile() && stats.nlink > 1)
        throw new FilePermissionError('不能访问硬链接文件')
    }
    const actual = await realpath(target)
    if (!inside(root, actual))
      throw new FilePermissionError('真实文件路径超出允许范围')
    return target
  }

  async readFile(
    input: string,
    maxBytes = MAX_AGENT_FILE_BYTES,
  ): Promise<Buffer> {
    const path = await this.resolve(input, 'read')
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    )
    try {
      const stats = await handle.stat()
      if (!stats.isFile() || stats.nlink > 1)
        throw new FilePermissionError('目标不是允许的普通文件')
      if (stats.size > maxBytes)
        throw new FilePermissionError('文件超过读取大小限制')
      const chunks: Buffer[] = []
      let total = 0
      while (total <= maxBytes) {
        const bytes = Buffer.alloc(Math.min(65536, maxBytes + 1 - total))
        const read = await handle.read(bytes, 0, bytes.length, null)
        if (!read.bytesRead) break
        total += read.bytesRead
        if (total > maxBytes)
          throw new FilePermissionError('文件超过读取大小限制')
        chunks.push(bytes.subarray(0, read.bytesRead))
      }
      return Buffer.concat(chunks, total)
    } finally {
      await handle.close()
    }
  }
}
