import * as fs from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listFiles,
  log,
  readBlob,
  resolveRef,
  statusMatrix,
} from 'isomorphic-git'
import { describe, expect, it } from 'vitest'
import {
  projectDirectoryRenamePaths,
  renameProjectDirectory,
} from '../project/project-files'
import { ProjectMutationService } from './project-mutation-service'
import { ProjectVersionService } from './project-version-service'

describe('ProjectVersionService', () => {
  it('records application mutations with a baseline and excludes unrelated external changes', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-versions-'))
    await writeFile(join(projectPath, 'notes.md'), '# original\n')
    await writeFile(join(projectPath, 'external.md'), '# external original\n')
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)

    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['notes.md'],
        source: 'text-editor',
      },
      () => writeFile(join(projectPath, 'notes.md'), '# saved in app\n'),
    )
    await versions.flush(projectPath)

    const gitdir = join(projectPath, '.slideMind', 'history.git')
    const commits = await log({ fs, dir: projectPath, gitdir })
    expect(commits).toHaveLength(2)
    expect(commits[0].commit.message).toContain('text-editor')
    expect(await listFiles({ fs, dir: projectPath, gitdir })).toEqual([
      'notes.md',
    ])

    const baselineOid = commits[1].oid
    const baseline = await readBlob({
      fs,
      dir: projectPath,
      gitdir,
      oid: baselineOid,
      filepath: 'notes.md',
    })
    expect(Buffer.from(baseline.blob).toString('utf8')).toBe('# original\n')

    await writeFile(join(projectPath, 'external.md'), '# changed externally\n')
    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['notes.md'],
        source: 'text-editor',
      },
      () => writeFile(join(projectPath, 'notes.md'), '# saved again\n'),
    )
    await versions.flush(projectPath)

    const externalStatus = await statusMatrix({
      fs,
      dir: projectPath,
      gitdir,
      filepaths: ['external.md'],
    })
    expect(externalStatus).toEqual([['external.md', 0, 2, 0]])
    expect(await readFile(join(projectPath, 'external.md'), 'utf8')).toBe(
      '# changed externally\n',
    )
  })

  it('does not create a version when an application operation leaves content unchanged', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-versions-'))
    await writeFile(join(projectPath, 'notes.md'), '# unchanged\n')
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)

    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['notes.md'],
        source: 'text-editor',
      },
      async () => undefined,
    )
    await versions.flush(projectPath)

    const gitdir = join(projectPath, '.slideMind', 'history.git')
    expect(
      await resolveRef({ fs, dir: projectPath, gitdir, ref: 'HEAD' }),
    ).toMatch(/^[a-f0-9]{40}$/)
    expect(await log({ fs, dir: projectPath, gitdir })).toHaveLength(1)
  })

  it('lists changes, compares content, and records a restored file as a new version', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-versions-'))
    await writeFile(join(projectPath, 'notes.md'), '# original\n')
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)
    const createdVersions: string[] = []
    versions.onCreated((event) => createdVersions.push(event.versionId))

    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['notes.md'],
        source: 'text-editor',
      },
      () => writeFile(join(projectPath, 'notes.md'), '# saved in app\n'),
    )
    await versions.flush(projectPath)

    const page = await versions.listVersions(projectPath)
    expect(createdVersions).toEqual([page.versions[0].id])
    expect(page.versions).toHaveLength(1)
    expect(page.versions[0]).toMatchObject({
      sources: ['text-editor'],
      changes: [{ path: 'notes.md', kind: 'modified' }],
    })

    const versionId = page.versions[0].id
    const savedComparison = await versions.compareFile(projectPath, {
      versionId,
      path: 'notes.md',
      target: 'previous',
    })
    expect(savedComparison.before).toMatchObject({
      status: 'text',
      content: '# original\n',
    })
    expect(savedComparison.after).toMatchObject({
      status: 'text',
      content: '# saved in app\n',
    })

    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['notes.md'],
        source: 'text-editor',
      },
      () => writeFile(join(projectPath, 'notes.md'), '# saved again in app\n'),
    )
    await versions.flush(projectPath)

    await writeFile(join(projectPath, 'notes.md'), '# changed externally\n')
    const currentComparison = await versions.compareFile(projectPath, {
      versionId,
      path: 'notes.md',
      target: 'current',
    })
    expect(currentComparison.after).toMatchObject({
      status: 'text',
      content: '# changed externally\n',
    })

    const result = await mutations.restoreVersion(projectPath, 'project-1', {
      versionId,
      files: [
        {
          path: 'notes.md',
          currentRevision: currentComparison.currentRevision,
        },
      ],
    })
    expect(result).toEqual({ ok: true, restoredPaths: ['notes.md'] })
    await versions.flush(projectPath)

    expect(await readFile(join(projectPath, 'notes.md'), 'utf8')).toBe(
      '# saved in app\n',
    )
    expect(
      (await versions.listVersions(projectPath)).versions[0].sources,
    ).toEqual(['restore'])
  })

  it('rejects a restore when the current file revision changed after comparison', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-versions-'))
    await writeFile(join(projectPath, 'notes.md'), '# original\n')
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)

    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['notes.md'],
        source: 'text-editor',
      },
      () => writeFile(join(projectPath, 'notes.md'), '# saved\n'),
    )
    await versions.flush(projectPath)
    const versionId = (await versions.listVersions(projectPath)).versions[0].id
    const comparison = await versions.compareFile(projectPath, {
      versionId,
      path: 'notes.md',
      target: 'current',
    })

    await writeFile(
      join(projectPath, 'notes.md'),
      '# changed after confirmation\n',
    )
    const result = await mutations.restoreVersion(projectPath, 'project-1', {
      versionId,
      files: [
        { path: 'notes.md', currentRevision: comparison.currentRevision },
      ],
    })

    expect(result).toEqual({
      ok: false,
      reason: 'conflict',
      paths: ['notes.md'],
    })
    expect(await readFile(join(projectPath, 'notes.md'), 'utf8')).toBe(
      '# changed after confirmation\n',
    )
  })

  it('represents and restores a deleted-file version without touching other files', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-versions-'))
    await writeFile(join(projectPath, 'obsolete.md'), '# obsolete\n')
    await writeFile(join(projectPath, 'external.md'), '# external\n')
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)
    const changedEvents: Array<{ path: string; kind: string }> = []
    mutations.onChanged((event) =>
      changedEvents.push({ path: event.path, kind: event.kind }),
    )

    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['obsolete.md'],
        source: 'agent',
      },
      () => unlink(join(projectPath, 'obsolete.md')),
    )
    await versions.flush(projectPath)
    const version = (await versions.listVersions(projectPath)).versions[0]
    expect(version.changes).toEqual([{ path: 'obsolete.md', kind: 'removed' }])
    expect(changedEvents).toContainEqual({
      path: 'obsolete.md',
      kind: 'remove',
    })

    await writeFile(
      join(projectPath, 'obsolete.md'),
      '# recreated externally\n',
    )
    const comparison = await versions.compareFile(projectPath, {
      versionId: version.id,
      path: 'obsolete.md',
      target: 'current',
    })
    const result = await mutations.restoreVersion(projectPath, 'project-1', {
      versionId: version.id,
      files: [
        { path: 'obsolete.md', currentRevision: comparison.currentRevision },
      ],
    })
    expect(result).toEqual({ ok: true, restoredPaths: ['obsolete.md'] })
    await expect(
      readFile(join(projectPath, 'obsolete.md'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await readFile(join(projectPath, 'external.md'), 'utf8')).toBe(
      '# external\n',
    )
  })

  it('records a file-tree rename as one removed and one added file', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-versions-'))
    await writeFile(join(projectPath, 'draft.md'), '# draft\n')
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)

    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['draft.md', 'final.md'],
        source: 'file-tree',
      },
      () =>
        rename(join(projectPath, 'draft.md'), join(projectPath, 'final.md')),
    )
    await versions.flush(projectPath)

    expect(
      (await versions.listVersions(projectPath)).versions[0],
    ).toMatchObject({
      sources: ['file-tree'],
      changes: [
        { path: 'draft.md', kind: 'removed' },
        { path: 'final.md', kind: 'added' },
      ],
    })
  })

  it('records every file moved by a directory rename', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-versions-'))
    await mkdir(join(projectPath, 'drafts'))
    await writeFile(join(projectPath, 'drafts', 'outline.md'), '# outline\n')
    await writeFile(join(projectPath, 'drafts', 'notes.txt'), 'notes\n')
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)
    const prepared = await projectDirectoryRenamePaths(projectPath, {
      path: 'drafts',
      name: 'published',
    })

    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: prepared.paths,
        source: 'file-tree',
      },
      () => renameProjectDirectory(projectPath, prepared.input),
    )
    await versions.flush(projectPath)

    expect(
      (await versions.listVersions(projectPath)).versions[0],
    ).toMatchObject({
      sources: ['file-tree'],
      changes: [
        { path: 'drafts/notes.txt', kind: 'removed' },
        { path: 'drafts/outline.md', kind: 'removed' },
        { path: 'published/notes.txt', kind: 'added' },
        { path: 'published/outline.md', kind: 'added' },
      ],
    })
  })

  it('recreates a missing parent directory when restoring a tracked file', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-versions-'))
    await mkdir(join(projectPath, 'notes'))
    await writeFile(join(projectPath, 'notes', 'outline.md'), '# original\n')
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)

    for (const content of ['# first version\n', '# second version\n']) {
      await mutations.run(
        {
          projectPath,
          projectHandle: 'project-1',
          paths: ['notes/outline.md'],
          source: 'text-editor',
        },
        () => writeFile(join(projectPath, 'notes', 'outline.md'), content),
      )
      await versions.flush(projectPath)
    }

    const firstVersion = (await versions.listVersions(projectPath)).versions[1]
    await rm(join(projectPath, 'notes'), { recursive: true })
    const comparison = await versions.compareFile(projectPath, {
      versionId: firstVersion.id,
      path: 'notes/outline.md',
      target: 'current',
    })
    expect(comparison.after).toEqual({ status: 'missing' })

    const result = await mutations.restoreVersion(projectPath, 'project-1', {
      versionId: firstVersion.id,
      files: [
        {
          path: 'notes/outline.md',
          currentRevision: comparison.currentRevision,
        },
      ],
    })
    expect(result).toEqual({ ok: true, restoredPaths: ['notes/outline.md'] })
    expect(
      await readFile(join(projectPath, 'notes', 'outline.md'), 'utf8'),
    ).toBe('# first version\n')
  })
})
