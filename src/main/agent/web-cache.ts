import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { WebError } from './web-transport'
import type { WebSource } from './web-search'

const TTL = 60 * 60 * 1000
const MAX_ENTRIES = 32
const MAX_BYTES = 16 * 1024 * 1024
const MAX_ENTRY_BYTES = 2 * 1024 * 1024
const ID = /^[a-f0-9-]{36}$/

export function visibleWebResponses(entries: readonly unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !('message' in entry)) continue
    const message = entry.message
    if (
      !message ||
      typeof message !== 'object' ||
      !('role' in message) ||
      message.role !== 'toolResult' ||
      !('details' in message)
    )
      continue
    const details = message.details
    if (
      details &&
      typeof details === 'object' &&
      'webResponseId' in details &&
      typeof details.webResponseId === 'string'
    )
      ids.add(details.webResponseId)
  }
  return ids
}

export class WebCache {
  constructor(
    private readonly directory: string,
    private readonly visible: () => Set<string>,
  ) {}

  async put(sources: WebSource[]): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const files = (await readdir(this.directory))
      .filter((name) => /^\d+-[a-f0-9-]{36}\.json$/.test(name))
      .sort()
    const id = randomUUID()
    // Preserve insertion order even when consecutive writes share a millisecond.
    const createdAt = Math.max(
      Date.now(),
      ...files.map((file) => Number(file.split('-')[0]) + 1),
    )
    const value = JSON.stringify({ version: 1, sources })
    if (Buffer.byteLength(value) > MAX_ENTRY_BYTES)
      throw new WebError('结果超过会话缓存大小限制')
    const sizes = await Promise.all(
      files.map(async (name) => ({
        name,
        size: (await stat(join(this.directory, name))).size,
      })),
    )
    let total = sizes.reduce(
      (sum, file) => sum + file.size,
      Buffer.byteLength(value),
    )
    let count = sizes.length + 1
    for (const file of sizes) {
      if (
        count <= MAX_ENTRIES &&
        total <= MAX_BYTES &&
        Date.now() - Number(file.name.split('-')[0]) <= TTL
      )
        continue
      await unlink(join(this.directory, file.name))
      total -= file.size
      count--
    }
    await writeFile(join(this.directory, `${createdAt}-${id}.json`), value, {
      mode: 0o600,
      flag: 'wx',
    })
    return id
  }

  async get(id: string): Promise<WebSource[]> {
    if (!ID.test(id) || !this.visible().has(id))
      throw new WebError('当前会话分支无法读取此结果')
    let files: string[]
    try {
      files = await readdir(this.directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new WebError('缓存不存在，请重新获取来源')
      throw error
    }
    const file = files.find(
      (name) =>
        name.endsWith(`-${id}.json`) && /^\d+-[a-f0-9-]{36}\.json$/.test(name),
    )
    if (!file || Date.now() - Number(file.split('-')[0]) > TTL)
      throw new WebError('结果已过期或被清理，请重新获取来源')
    const result = JSON.parse(
      await readFile(join(this.directory, file), 'utf8'),
    ) as { version: number; sources: WebSource[] }
    if (result.version !== 1)
      throw new WebError('缓存版本不兼容，请重新获取来源')
    return result.sources
  }
}
