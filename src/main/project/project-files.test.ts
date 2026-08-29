import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { listProjectDirectory } from './project-files'

describe('listProjectDirectory', () => {
  it('lists folders before files and returns project-relative paths', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    await mkdir(join(projectPath, 'assets'))
    await writeFile(join(projectPath, 'notes.md'), 'Notes')

    expect(await listProjectDirectory(projectPath, '')).toEqual([
      { kind: 'directory', name: 'assets', path: 'assets' },
      { kind: 'file', name: 'notes.md', path: 'notes.md' }
    ])
  })

  it('hides the internal SlideMind directory from the project file tree', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    await mkdir(join(projectPath, '.slideMind'))
    await writeFile(join(projectPath, 'notes.md'), 'Notes')

    expect(await listProjectDirectory(projectPath, '')).toEqual([
      { kind: 'file', name: 'notes.md', path: 'notes.md' }
    ])
  })

  it('lists a nested project directory', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    await mkdir(join(projectPath, 'assets'))
    await writeFile(join(projectPath, 'assets', 'cover.png'), 'image')

    expect(await listProjectDirectory(projectPath, 'assets')).toEqual([
      { kind: 'file', name: 'cover.png', path: join('assets', 'cover.png') }
    ])
  })

  it('rejects paths outside the project', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))

    await expect(listProjectDirectory(projectPath, '..')).rejects.toThrow(
      '目录路径超出项目范围'
    )
    await expect(listProjectDirectory(projectPath, projectPath)).rejects.toThrow('目录路径无效')
  })
})
