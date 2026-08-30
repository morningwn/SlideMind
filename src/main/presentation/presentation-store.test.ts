import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createBlankPresentationDocument,
  ProjectPresentationStore
} from './presentation-store'

describe('ProjectPresentationStore', () => {
  it('creates and reads a versioned Univer Slides snapshot', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-presentations-'))
    const store = new ProjectPresentationStore()

    const created = await store.create(projectPath, {
      path: 'quarterly.slides.json',
      title: '季度复盘'
    })
    const loaded = await store.read(projectPath, created.path)

    expect(loaded).toMatchObject({
      path: 'quarterly.slides.json',
      revision: created.revision,
      document: {
        format: 'slidemind.presentation',
        version: 1,
        snapshot: { title: '季度复盘', pageSize: { width: 960, height: 540 } }
      }
    })
    expect(loaded.document.snapshot.body?.pageOrder).toHaveLength(1)
  })

  it('saves atomically and reports external modification conflicts', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-presentations-'))
    const filePath = join(projectPath, 'deck.slides.json')
    const store = new ProjectPresentationStore()
    const created = await store.create(projectPath, { path: 'deck.slides.json' })
    const document = structuredClone(created.document)
    document.snapshot.title = '应用内修改'

    await writeFile(filePath, `${JSON.stringify(createBlankPresentationDocument('外部修改'))}\n`)
    await expect(store.save(projectPath, {
      path: created.path,
      revision: created.revision,
      document
    })).resolves.toMatchObject({ ok: false, reason: 'conflict' })
    expect((JSON.parse(await readFile(filePath, 'utf8')) as { snapshot: { title: string } })
      .snapshot.title).toBe('外部修改')
  })

  it('rejects traversal, symbolic links, internal paths and unsupported extensions', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-presentations-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-presentations-outside-'))
    const outsideFile = join(outsidePath, 'outside.slides.json')
    await writeFile(outsideFile, JSON.stringify(createBlankPresentationDocument()))
    await symlink(outsideFile, join(projectPath, 'linked.slides.json'))
    await mkdir(join(projectPath, '.slideMind'))
    const store = new ProjectPresentationStore()

    await expect(store.read(projectPath, '../outside.slides.json')).rejects.toThrow('超出项目范围')
    await expect(store.read(projectPath, 'linked.slides.json')).rejects.toThrow('符号链接')
    await expect(store.create(projectPath, {
      path: '.slideMind/private.slides.json'
    })).rejects.toThrow('内部文件')
    await expect(store.create(projectPath, { path: 'deck.json' })).rejects.toThrow(
      '.slides.json 扩展名'
    )
  })

  it('rejects malformed and unsafe snapshots', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-presentations-'))
    await writeFile(join(projectPath, 'bad.slides.json'), JSON.stringify({
      format: 'slidemind.presentation',
      version: 1,
      snapshot: { id: 'bad', title: 'bad', pageSize: { width: 0, height: 540 } }
    }))
    await writeFile(join(projectPath, 'unsafe.slides.json'), '{"format":"slidemind.presentation","version":1,"__proto__":{},"snapshot":{}}')
    const store = new ProjectPresentationStore()

    await expect(store.read(projectPath, 'bad.slides.json')).rejects.toThrow('宽度无效')
    await expect(store.read(projectPath, 'unsafe.slides.json')).rejects.toThrow('不安全字段')
  })
})
