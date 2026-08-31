import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  createProjectDirectory,
  createProjectMarkdownFile,
  deleteProjectDirectory,
  deleteProjectFile,
  listProjectDirectory,
  projectDirectoryDeletePaths,
  projectDirectoryRenamePaths,
  renameProjectDirectory,
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

  it('creates project directories and Markdown documents', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))

    await expect(createProjectDirectory(projectPath, 'docs')).resolves.toEqual({
      kind: 'directory',
      name: 'docs',
      path: 'docs'
    })
    await expect(createProjectMarkdownFile(
      projectPath,
      join('docs', 'notes.md')
    )).resolves.toEqual({
      kind: 'file',
      name: 'notes.md',
      path: join('docs', 'notes.md')
    })
    await expect(readFile(join(projectPath, 'docs', 'notes.md'), 'utf8')).resolves.toBe(
      '# 未命名文档\n'
    )
  })

  it('rejects unsafe, duplicate and unsupported creation targets', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-files-outside-'))
    await mkdir(join(projectPath, '.slideMind'))
    await mkdir(join(projectPath, 'existing'))
    await symlink(outsidePath, join(projectPath, 'linked'))

    await expect(createProjectDirectory(projectPath, '../outside')).rejects.toThrow(
      '超出项目范围'
    )
    await expect(createProjectDirectory(projectPath, '.slideMind/private')).rejects.toThrow(
      '内部目录'
    )
    await expect(createProjectDirectory(projectPath, 'existing')).rejects.toThrow('同名')
    await expect(createProjectMarkdownFile(projectPath, 'notes.txt')).rejects.toThrow(
      'Markdown 文件必须使用'
    )
    await expect(createProjectMarkdownFile(
      projectPath,
      join('linked', 'notes.md')
    )).rejects.toThrow('符号链接')
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
    })).rejects.toThrow('新名称无效')
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

  it('renames a directory and prepares old and new version paths', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    await mkdir(join(projectPath, 'drafts', 'nested'), { recursive: true })
    await writeFile(join(projectPath, 'drafts', 'outline.md'), 'Outline')
    await writeFile(join(projectPath, 'drafts', 'nested', 'notes.txt'), 'Notes')
    const input = { path: 'drafts', name: 'published' }

    await expect(projectDirectoryRenamePaths(projectPath, input)).resolves.toEqual({
      input,
      paths: [
        join('drafts', 'nested', 'notes.txt'),
        join('drafts', 'outline.md'),
        join('published', 'nested', 'notes.txt'),
        join('published', 'outline.md')
      ]
    })
    await expect(renameProjectDirectory(projectPath, input)).resolves.toEqual({
      kind: 'directory',
      name: 'published',
      path: 'published'
    })
    await expect(readFile(
      join(projectPath, 'published', 'nested', 'notes.txt'),
      'utf8'
    )).resolves.toBe('Notes')
    await expect(access(join(projectPath, 'drafts'))).rejects.toThrow()
  })

  it('recursively deletes a directory and reports its versioned files', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    await mkdir(join(projectPath, 'obsolete', 'nested'), { recursive: true })
    await writeFile(join(projectPath, 'obsolete', 'first.md'), 'First')
    await writeFile(join(projectPath, 'obsolete', 'nested', 'second.md'), 'Second')

    await expect(projectDirectoryDeletePaths(projectPath, 'obsolete')).resolves.toEqual({
      path: 'obsolete',
      paths: [
        join('obsolete', 'first.md'),
        join('obsolete', 'nested', 'second.md')
      ]
    })
    await expect(deleteProjectDirectory(projectPath, 'obsolete')).resolves.toBeUndefined()
    await expect(access(join(projectPath, 'obsolete'))).rejects.toThrow()
  })

  it('rejects root, internal, symbolic-link and duplicate directory operations', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-files-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-files-outside-'))
    await mkdir(join(projectPath, 'first'))
    await mkdir(join(projectPath, 'second'))
    await mkdir(join(projectPath, '.slideMind'))
    await symlink(outsidePath, join(projectPath, 'linked'))

    await expect(deleteProjectDirectory(projectPath, '.')).rejects.toThrow('超出项目范围')
    await expect(deleteProjectDirectory(projectPath, '.slideMind')).rejects.toThrow('内部目录')
    await expect(deleteProjectDirectory(projectPath, 'linked')).rejects.toThrow('符号链接')
    await expect(renameProjectDirectory(projectPath, {
      path: 'first',
      name: 'second'
    })).rejects.toThrow('同名文件夹已存在')
  })
})
