import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  deleteProjectFile,
  listProjectDirectory,
  renameProjectFile
} from './project-files'

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

  it('hides internal metadata directories from the project file tree', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    await mkdir(join(projectPath, '.slideMind'))
    await mkdir(join(projectPath, '.git'))
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

  it('renames a regular file without leaving the project', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    await mkdir(join(projectPath, 'notes'))
    await writeFile(join(projectPath, 'notes', 'draft.md'), 'Draft')

    await expect(renameProjectFile(projectPath, {
      path: join('notes', 'draft.md'),
      name: 'final.md'
    })).resolves.toEqual({
      kind: 'file',
      name: 'final.md',
      path: join('notes', 'final.md')
    })
    await expect(readFile(join(projectPath, 'notes', 'final.md'), 'utf8')).resolves.toBe('Draft')
    await expect(access(join(projectPath, 'notes', 'draft.md'))).rejects.toThrow()
  })

  it('rejects invalid names, duplicate files and symbolic links', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-files-outside-'))
    await writeFile(join(projectPath, 'first.md'), 'First')
    await writeFile(join(projectPath, 'second.md'), 'Second')
    await writeFile(join(outsidePath, 'outside.md'), 'Outside')
    await symlink(join(outsidePath, 'outside.md'), join(projectPath, 'linked.md'))

    await expect(renameProjectFile(projectPath, {
      path: 'first.md',
      name: '../outside.md'
    })).rejects.toThrow('新文件名无效')
    await expect(renameProjectFile(projectPath, {
      path: 'first.md',
      name: 'second.md'
    })).rejects.toThrow('同名文件已存在')
    await expect(renameProjectFile(projectPath, {
      path: 'linked.md',
      name: 'renamed.md'
    })).rejects.toThrow('符号链接')
  })

  it('deletes regular files but rejects directories and internal files', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    await mkdir(join(projectPath, 'folder'))
    await mkdir(join(projectPath, '.slideMind'))
    await writeFile(join(projectPath, 'obsolete.md'), 'Obsolete')
    await writeFile(join(projectPath, '.slideMind', 'private.md'), 'Private')

    await expect(deleteProjectFile(projectPath, 'obsolete.md')).resolves.toBeUndefined()
    await expect(access(join(projectPath, 'obsolete.md'))).rejects.toThrow()
    await expect(deleteProjectFile(projectPath, 'folder')).rejects.toThrow('普通文件')
    await expect(deleteProjectFile(
      projectPath,
      join('.slideMind', 'private.md')
    )).rejects.toThrow('内部文件')
    await expect(listProjectDirectory(projectPath, '.slideMind')).rejects.toThrow('内部目录')
    await expect(listProjectDirectory(projectPath, '.git')).rejects.toThrow('内部目录')
  })
})
