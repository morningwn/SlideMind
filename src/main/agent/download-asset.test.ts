import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AssetOpener,
  downloadAsset,
  resolveDownloadTarget
} from './download-asset'

const temporaryDirectories: string[] = []

async function createProject(): Promise<string> {
  const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-download-'))
  temporaryDirectories.push(projectPath)
  return projectPath
}

function response(
  statusCode: number,
  content: string | Buffer,
  headers: Record<string, string> = {}
) {
  return {
    body: Readable.from([content]),
    headers,
    statusCode
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ))
})

describe('downloadAsset', () => {
  it('follows HTTPS redirects and saves UTF-8 text in a nested project path', async () => {
    const projectPath = await createProject()
    const visited: string[] = []
    const openAsset: AssetOpener = async (url) => {
      visited.push(url.toString())
      return visited.length === 1
        ? response(302, '', { location: '/files/notes.md' })
        : response(200, '# Notes\n', {
            'content-length': '8',
            'content-type': 'text/markdown; charset=utf-8'
          })
    }

    const result = await downloadAsset({
      kind: 'text',
      openAsset,
      path: 'assets/research/notes.md',
      projectPath,
      url: 'https://example.com/start?token=secret'
    })

    expect(visited).toEqual([
      'https://example.com/start?token=secret',
      'https://example.com/files/notes.md'
    ])
    expect(result).toMatchObject({
      bytes: 8,
      contentType: 'text/markdown',
      finalUrl: 'https://example.com/files/notes.md',
      path: join('assets', 'research', 'notes.md')
    })
    expect(await readFile(result.targetPath, 'utf8')).toBe('# Notes\n')
  })

  it('rejects insecure redirect targets before opening them', async () => {
    const projectPath = await createProject()
    const openAsset: AssetOpener = async () => response(302, '', {
      location: 'http://example.com/plain.txt'
    })

    await expect(downloadAsset({
      kind: 'text',
      openAsset,
      path: 'plain.txt',
      projectPath,
      url: 'https://example.com/start'
    })).rejects.toThrow('下载仅支持 HTTPS 地址')
    expect(await readdir(projectPath)).toEqual([])
  })

  it('blocks private network destinations through the Microsoft AntiSSRF agent', async () => {
    const projectPath = await createProject()

    await expect(downloadAsset({
      kind: 'text',
      path: 'private.txt',
      projectPath,
      url: 'https://127.0.0.1/private.txt'
    })).rejects.toThrow(/disallowed by policy/i)
    expect(await readdir(projectPath)).toEqual([])
  })

  it('rejects non-UTF-8 text and removes the temporary file', async () => {
    const projectPath = await createProject()
    const openAsset: AssetOpener = async () => response(
      200,
      Buffer.from([0xff, 0xfe, 0xfd]),
      { 'content-length': '3' }
    )

    await expect(downloadAsset({
      kind: 'text',
      openAsset,
      path: 'assets/data.txt',
      projectPath,
      url: 'https://example.com/data.txt'
    })).rejects.toThrow('下载内容不是有效的 UTF-8 文本')
    expect(await readdir(join(projectPath, 'assets'))).toEqual([])
  })

  it('validates image bytes before committing the target file', async () => {
    const projectPath = await createProject()
    let validated = ''
    const result = await downloadAsset({
      kind: 'image',
      openAsset: async () => response(200, 'image-bytes'),
      path: 'assets/image.png',
      projectPath,
      url: 'https://example.com/image.png',
      validateImage: async (path) => {
        validated = await readFile(path, 'utf8')
      }
    })

    expect(validated).toBe('image-bytes')
    expect(await readFile(result.targetPath, 'utf8')).toBe('image-bytes')
  })

  it('rejects project escapes, internal paths, plain HTTP and URL credentials', async () => {
    const projectPath = await createProject()

    await expect(resolveDownloadTarget(projectPath, '../outside.txt'))
      .rejects.toThrow('下载路径超出项目范围')
    await expect(resolveDownloadTarget(projectPath, '.git/config'))
      .rejects.toThrow('不能下载到受保护的项目目录')
    await expect(resolveDownloadTarget(projectPath, 'node_modules/package/file.js'))
      .rejects.toThrow('不能下载到受保护的项目目录')
    await expect(downloadAsset({
      kind: 'text',
      openAsset: async () => response(200, 'unsafe'),
      path: 'plain.txt',
      projectPath,
      url: 'http://example.com/plain.txt'
    })).rejects.toThrow('下载仅支持 HTTPS 地址')
    await expect(downloadAsset({
      kind: 'text',
      openAsset: async () => response(200, 'unsafe'),
      path: 'secret.txt',
      projectPath,
      url: 'https://user:password@example.com/secret.txt'
    })).rejects.toThrow('下载地址不能包含凭据')
  })
})
