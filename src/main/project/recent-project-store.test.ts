import { mkdtemp, mkdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { RecentProjectStore, resolveProject } from './recent-project-store'

describe('RecentProjectStore', () => {
  it('records projects in most-recent order without duplicates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-recent-'))
    const store = new RecentProjectStore(join(directory, 'recent-projects.json'))
    const first = { name: 'First', path: '/projects/first', lastOpenedAt: '2026-08-27T09:00:00.000Z' }
    const second = { name: 'Second', path: '/projects/second', lastOpenedAt: '2026-08-28T09:00:00.000Z' }

    await store.record(first)
    await store.record(second)
    await store.record({ ...first, lastOpenedAt: '2026-08-29T09:00:00.000Z' })

    expect(await store.list()).toEqual([
      { ...first, lastOpenedAt: '2026-08-29T09:00:00.000Z' },
      second
    ])
  })

  it('removes a recent project and persists valid JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-recent-'))
    const storePath = join(directory, 'recent-projects.json')
    const store = new RecentProjectStore(storePath)
    const project = { name: 'Deck', path: '/projects/deck', lastOpenedAt: '2026-08-29T09:00:00.000Z' }

    await store.record(project)
    expect(await store.remove(project.path)).toEqual([])
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toEqual({ version: 1, projects: [] })
  })
})

describe('resolveProject', () => {
  it('returns canonical information for a directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-project-'))
    const projectPath = join(directory, 'Quarterly deck')
    await mkdir(projectPath)

    const project = await resolveProject(projectPath)

    expect(project.name).toBe('Quarterly deck')
    expect(project.path).toBe(await realpath(projectPath))
    expect(Date.parse(project.lastOpenedAt)).not.toBeNaN()
  })

  it('rejects invalid paths', async () => {
    await expect(resolveProject('')).rejects.toThrow('项目路径无效')
    await expect(resolveProject('/path/that/does/not/exist')).rejects.toThrow(
      '项目文件夹不存在或无法访问'
    )
  })
})
