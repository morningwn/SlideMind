import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProjectTextFileStore, readMarkdownExportImage } from './project-text-files'

describe('ProjectTextFileStore', () => {
  it('reads Markdown metadata and preserves CRLF plus a UTF-8 BOM when saving', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-text-files-'))
    const filePath = join(projectPath, 'notes.md')
    await writeFile(filePath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('# 标题\r\n\r\n正文\r\n')
    ]))
    const store = new ProjectTextFileStore()

    const file = await store.read(projectPath, 'notes.md')
    expect(file).toMatchObject({
      path: 'notes.md',
      kind: 'markdown',
      content: '# 标题\r\n\r\n正文\r\n',
      lineEnding: 'crlf',
      hasBom: true
    })

    const result = await store.save(projectPath, {
      path: file.path,
      content: `${file.content}补充\r\n`,
      revision: file.revision,
      hasBom: file.hasBom
    })
    expect(result.ok).toBe(true)
    expect(await readFile(filePath)).toEqual(Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('# 标题\r\n\r\n正文\r\n补充\r\n')
    ]))
  })

  it('detects an external modification instead of overwriting it', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-text-files-'))
    const filePath = join(projectPath, 'notes.txt')
    await writeFile(filePath, '原始内容')
    const store = new ProjectTextFileStore()
    const file = await store.read(projectPath, 'notes.txt')
    await writeFile(filePath, '外部修改')

    await expect(store.save(projectPath, {
      path: file.path,
      content: '应用内修改',
      revision: file.revision,
      hasBom: false
    })).resolves.toMatchObject({ ok: false, reason: 'conflict' })
    expect(await readFile(filePath, 'utf8')).toBe('外部修改')
  })

  it('rejects unsupported, binary, oversized and internal files', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-text-files-'))
    await writeFile(join(projectPath, 'data.json'), '{}')
    await writeFile(join(projectPath, 'binary.txt'), Buffer.from([1, 0, 2]))
    await writeFile(join(projectPath, 'large.md'), Buffer.alloc(2 * 1024 * 1024 + 1, 65))
    await mkdir(join(projectPath, '.slideMind'))
    await writeFile(join(projectPath, '.slideMind', 'private.txt'), 'private')
    const store = new ProjectTextFileStore()

    await expect(store.read(projectPath, 'data.json')).rejects.toThrow('仅支持 Markdown 和 TXT')
    await expect(store.read(projectPath, 'binary.txt')).rejects.toThrow('二进制内容')
    await expect(store.read(projectPath, 'large.md')).rejects.toThrow('超过 2 MiB')
    await expect(store.read(projectPath, '.slideMind/private.txt')).rejects.toThrow('内部文件')
  })

  it('rejects paths outside the project and symbolic links', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-text-files-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-text-files-outside-'))
    await writeFile(join(outsidePath, 'outside.md'), '# outside')
    await symlink(join(outsidePath, 'outside.md'), join(projectPath, 'linked.md'))
    const store = new ProjectTextFileStore()

    await expect(store.read(projectPath, '../outside.md')).rejects.toThrow('超出项目范围')
    await expect(store.read(projectPath, 'linked.md')).rejects.toThrow('符号链接')
  })

  it('loads only safe project-relative images for Markdown previews', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-text-files-'))
    await mkdir(join(projectPath, 'docs'))
    await mkdir(join(projectPath, 'images'))
    await writeFile(join(projectPath, 'docs', 'notes.md'), '# Notes')
    await writeFile(join(projectPath, 'images', 'cover.png'), Buffer.from([1, 2, 3]))
    const store = new ProjectTextFileStore()

    await expect(
      store.readPreviewAsset(projectPath, 'docs/notes.md', '../images/cover.png')
    ).resolves.toBe('data:image/png;base64,AQID')
    await expect(
      store.readPreviewAsset(projectPath, 'docs/notes.md', 'https://example.com/cover.png')
    ).rejects.toThrow('预览资源路径无效')
  })

  it.each([
    ['cover.png', 'image/png'],
    ['photo.JPG', 'image/jpeg'],
    ['animation.gif', 'image/gif'],
    ['graphic.webp', 'image/webp']
  ])('loads %s as a standalone image preview', async (name, mimeType) => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-image-files-'))
    await writeFile(join(projectPath, name), Buffer.from([1, 2, 3]))
    const store = new ProjectTextFileStore()

    await expect(store.readImage(projectPath, name)).resolves.toMatchObject({
      path: name,
      mimeType,
      dataUrl: `data:${mimeType};base64,AQID`,
      size: 3
    })
  })

  it('rejects unsupported, oversized and symbolic-link image previews', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-image-files-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-image-files-outside-'))
    await writeFile(join(projectPath, 'vector.svg'), '<svg />')
    await writeFile(join(projectPath, 'large.png'), Buffer.alloc(20 * 1024 * 1024 + 1))
    await writeFile(join(outsidePath, 'outside.png'), Buffer.from([1, 2, 3]))
    await symlink(join(outsidePath, 'outside.png'), join(projectPath, 'linked.png'))
    const store = new ProjectTextFileStore()

    await expect(store.readImage(projectPath, 'vector.svg')).rejects.toThrow('仅支持 PNG')
    await expect(store.readImage(projectPath, 'large.png')).rejects.toThrow('超过 20 MiB')
    await expect(store.readImage(projectPath, 'linked.png')).rejects.toThrow('符号链接')
  })

  it('loads only real PNG and JPEG bytes for Markdown Word export', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-export-images-'))
    await mkdir(join(projectPath, 'docs'))
    await mkdir(join(projectPath, 'images'))
    await writeFile(join(projectPath, 'docs', 'notes.md'), '# Notes')
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('content')
    ])
    await writeFile(join(projectPath, 'images', 'valid.png'), png)
    await writeFile(join(projectPath, 'images', 'fake.png'), 'not a png')
    await writeFile(join(projectPath, 'images', 'graphic.webp'), 'webp')

    await expect(
      readMarkdownExportImage(projectPath, 'docs/notes.md', '../images/valid.png?cache=1')
    ).resolves.toEqual({ bytes: png, mimeType: 'image/png' })
    await expect(
      readMarkdownExportImage(projectPath, 'docs/notes.md', '../images/fake.png')
    ).rejects.toThrow('内容无效')
    await expect(
      readMarkdownExportImage(projectPath, 'docs/notes.md', '../images/graphic.webp')
    ).rejects.toThrow('仅支持 PNG 和 JPEG')
  })

  it('rejects remote, absolute, escaping and symbolic-link export images', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-export-images-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-export-images-outside-'))
    await writeFile(join(projectPath, 'notes.md'), '# Notes')
    await writeFile(join(outsidePath, 'outside.png'), 'outside')
    await symlink(join(outsidePath, 'outside.png'), join(projectPath, 'linked.png'))

    await expect(
      readMarkdownExportImage(projectPath, 'notes.md', 'https://example.com/a.png')
    ).rejects.toThrow('当前项目内')
    await expect(readMarkdownExportImage(projectPath, 'notes.md', '/etc/passwd')).rejects.toThrow(
      '当前项目内'
    )
    await expect(
      readMarkdownExportImage(projectPath, 'notes.md', '../outside.png')
    ).rejects.toThrow('超出项目范围')
    await expect(readMarkdownExportImage(projectPath, 'notes.md', 'linked.png')).rejects.toThrow(
      '符号链接'
    )
  })
})
