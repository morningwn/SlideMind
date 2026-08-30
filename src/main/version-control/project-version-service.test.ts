import * as fs from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listFiles, log, readBlob, resolveRef, statusMatrix } from 'isomorphic-git'
import { describe, expect, it } from 'vitest'
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
        source: 'text-editor'
      },
      () => writeFile(join(projectPath, 'notes.md'), '# saved in app\n')
    )
    await versions.flush(projectPath)

    const gitdir = join(projectPath, '.slideMind', 'history.git')
    const commits = await log({ fs, dir: projectPath, gitdir })
    expect(commits).toHaveLength(2)
    expect(commits[0].commit.message).toContain('text-editor')
    expect(await listFiles({ fs, dir: projectPath, gitdir })).toEqual(['notes.md'])

    const baselineOid = commits[1].oid
    const baseline = await readBlob({
      fs,
      dir: projectPath,
      gitdir,
      oid: baselineOid,
      filepath: 'notes.md'
    })
    expect(Buffer.from(baseline.blob).toString('utf8')).toBe('# original\n')

    await writeFile(join(projectPath, 'external.md'), '# changed externally\n')
    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['notes.md'],
        source: 'text-editor'
      },
      () => writeFile(join(projectPath, 'notes.md'), '# saved again\n')
    )
    await versions.flush(projectPath)

    const externalStatus = await statusMatrix({
      fs,
      dir: projectPath,
      gitdir,
      filepaths: ['external.md']
    })
    expect(externalStatus).toEqual([['external.md', 0, 2, 0]])
    expect(await readFile(join(projectPath, 'external.md'), 'utf8')).toBe('# changed externally\n')
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
        source: 'text-editor'
      },
      async () => undefined
    )
    await versions.flush(projectPath)

    const gitdir = join(projectPath, '.slideMind', 'history.git')
    expect(await resolveRef({ fs, dir: projectPath, gitdir, ref: 'HEAD' })).toMatch(/^[a-f0-9]{40}$/)
    expect(await log({ fs, dir: projectPath, gitdir })).toHaveLength(1)
  })
})
