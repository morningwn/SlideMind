import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createBlankPresentationDocument,
  ProjectPresentationStore,
} from './presentation-store'

describe('ProjectPresentationStore', () => {
  it('creates and reads a versioned PPTist document', async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), 'slidemind-presentations-'),
    )
    const store = new ProjectPresentationStore()

    const created = await store.create(projectPath, {
      path: 'quarterly.slides.json',
      title: '季度复盘',
    })
    const loaded = await store.read(projectPath, created.path)

    expect(loaded).toMatchObject({
      path: 'quarterly.slides.json',
      revision: created.revision,
      document: {
        format: 'slidemind.presentation',
        version: 2,
        presentation: {
          title: '季度复盘',
          viewportSize: 1000,
          viewportRatio: 0.5625,
        },
      },
    })
    expect(loaded.document.presentation.slides).toHaveLength(1)
  })

  it('imports a complete PPTist document without creating an intermediate blank version', async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), 'slidemind-presentations-import-'),
    )
    const store = new ProjectPresentationStore()
    const document = createBlankPresentationDocument('外部演示')
    document.presentation.slides[0].remark = '演讲者备注'
    document.presentation.slides[0].elements.push({
      id: 'imported-text',
      type: 'text',
      left: 40,
      top: 40,
      width: 300,
      height: 80,
      rotate: 0,
      content: '<p>导入内容</p>',
    })

    const imported = await store.import(projectPath, {
      path: 'external.slides.json',
      document,
    })
    const loaded = await store.read(projectPath, imported.path)

    expect(loaded.revision).toBe(imported.revision)
    expect(loaded.document.presentation).toMatchObject({
      title: '外部演示',
      slides: [{ remark: '演讲者备注', elements: [{ id: 'imported-text' }] }],
    })
    await expect(
      store.import(projectPath, {
        path: 'external.slides.json',
        document,
      }),
    ).rejects.toThrow('不能覆盖')
  })

  it('saves repeated PPTist edits without changing the document format', async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), 'slidemind-presentations-'),
    )
    const store = new ProjectPresentationStore()
    const created = await store.create(projectPath, {
      path: 'deck.slides.json',
    })
    const firstEdit = structuredClone(created.document)
    firstEdit.presentation.title = '第一次修改'

    const firstSave = await store.save(projectPath, {
      path: created.path,
      revision: created.revision,
      document: firstEdit,
    })
    if (!firstSave.ok) throw new Error('第一次保存冲突')

    const secondEdit = structuredClone(firstEdit)
    secondEdit.presentation.slides[0].elements.push({
      id: 'text-1',
      type: 'text',
      left: 80,
      top: -5,
      width: 400,
      height: 0,
      rotate: 0,
      content: '<p>第二次修改</p>',
      defaultFontName: '',
      defaultColor: '#333333',
    })
    const secondSave = await store.save(projectPath, {
      path: created.path,
      revision: firstSave.revision,
      document: secondEdit,
    })

    expect(secondSave).toMatchObject({ ok: true })
    const loaded = await store.read(projectPath, created.path)
    expect(loaded.document.presentation.title).toBe('第一次修改')
    expect(loaded.document.presentation.slides[0].elements).toHaveLength(1)
  })

  it('reports external modification conflicts', async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), 'slidemind-presentations-'),
    )
    const filePath = join(projectPath, 'deck.slides.json')
    const store = new ProjectPresentationStore()
    const created = await store.create(projectPath, {
      path: 'deck.slides.json',
    })
    const document = structuredClone(created.document)
    document.presentation.title = '应用内修改'

    await writeFile(
      filePath,
      `${JSON.stringify(createBlankPresentationDocument('外部修改'))}\n`,
    )
    await expect(
      store.save(projectPath, {
        path: created.path,
        revision: created.revision,
        document,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'conflict' })
    const stored = JSON.parse(await readFile(filePath, 'utf8')) as {
      presentation: { title: string }
    }
    expect(stored.presentation.title).toBe('外部修改')
  })

  it('rejects traversal, symbolic links, internal paths and unsupported extensions', async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), 'slidemind-presentations-'),
    )
    const outsidePath = await mkdtemp(
      join(tmpdir(), 'slidemind-presentations-outside-'),
    )
    const outsideFile = join(outsidePath, 'outside.slides.json')
    await writeFile(
      outsideFile,
      JSON.stringify(createBlankPresentationDocument()),
    )
    await symlink(outsideFile, join(projectPath, 'linked.slides.json'))
    await mkdir(join(projectPath, '.slideMind'))
    const store = new ProjectPresentationStore()

    await expect(
      store.read(projectPath, '../outside.slides.json'),
    ).rejects.toThrow('超出项目范围')
    await expect(store.read(projectPath, 'linked.slides.json')).rejects.toThrow(
      '符号链接',
    )
    await expect(
      store.create(projectPath, {
        path: '.slideMind/private.slides.json',
      }),
    ).rejects.toThrow('内部文件')
    await expect(
      store.create(projectPath, { path: 'deck.json' }),
    ).rejects.toThrow('.slides.json 扩展名')
  })

  it('rejects old, malformed and unsafe documents', async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), 'slidemind-presentations-'),
    )
    await writeFile(
      join(projectPath, 'old.slides.json'),
      JSON.stringify({
        format: 'slidemind.presentation',
        version: 1,
        snapshot: {},
      }),
    )
    const bad = createBlankPresentationDocument('bad')
    bad.presentation.viewportSize = 0
    await writeFile(join(projectPath, 'bad.slides.json'), JSON.stringify(bad))
    await writeFile(
      join(projectPath, 'unsafe.slides.json'),
      '{"format":"slidemind.presentation","version":2,"__proto__":{},"presentation":{}}',
    )
    const store = new ProjectPresentationStore()

    await expect(store.read(projectPath, 'old.slides.json')).rejects.toThrow(
      '不支持',
    )
    await expect(store.read(projectPath, 'bad.slides.json')).rejects.toThrow(
      '画布宽度无效',
    )
    await expect(store.read(projectPath, 'unsafe.slides.json')).rejects.toThrow(
      '不安全字段',
    )
  })
})
