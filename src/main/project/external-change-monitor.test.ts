import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectFileChangedEvent } from '../../shared/project'
import { ProjectMutationService } from '../version-control/project-mutation-service'
import { ProjectVersionService } from '../version-control/project-version-service'
import { ExternalChangeMonitor } from './external-change-monitor'

async function waitForEvents(
  events: ProjectFileChangedEvent[],
  count: number,
): Promise<void> {
  const deadline = Date.now() + 4_000
  while (events.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (events.length < count)
    throw new Error(`Timed out waiting for ${count} file events`)
}

describe('ExternalChangeMonitor', () => {
  it('reports changes throughout the project and ignores internal directories', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-watch-'))
    await mkdir(join(projectPath, 'visible'))
    await mkdir(join(projectPath, 'nested'))
    await mkdir(join(projectPath, 'nested', 'deep'))
    await mkdir(join(projectPath, '.slidemind'))
    await writeFile(join(projectPath, 'opened.md'), '# open\n')
    await writeFile(
      join(projectPath, 'nested', 'deep', 'existing.md'),
      '# existing\n',
    )
    const versions = new ProjectVersionService()
    const mutations = new ProjectMutationService(versions)
    const monitor = new ExternalChangeMonitor(mutations, { usePolling: true })
    const events: ProjectFileChangedEvent[] = []
    monitor.onChanged((event) => events.push(event))

    await monitor.setScope(projectPath, 'project-1', {
      files: ['opened.md'],
      directories: ['visible'],
    })
    await writeFile(join(projectPath, 'opened.md'), '# changed externally\n')
    await writeFile(join(projectPath, 'visible', 'new.md'), '# visible\n')
    await writeFile(
      join(projectPath, 'nested', 'deep', 'existing.md'),
      '# changed\n',
    )
    await writeFile(
      join(projectPath, '.slidemind', 'internal.md'),
      '# internal\n',
    )
    await waitForEvents(events, 3)

    expect(events.map((event) => event.path).sort()).toEqual(
      [
        join('nested', 'deep', 'existing.md'),
        'opened.md',
        join('visible', 'new.md'),
      ].sort(),
    )
    expect(events.every((event) => event.source === 'external')).toBe(true)

    const beforeInternalWrite = events.length
    await mutations.run(
      {
        projectPath,
        projectHandle: 'project-1',
        paths: ['opened.md'],
        source: 'text-editor',
      },
      () => writeFile(join(projectPath, 'opened.md'), '# changed internally\n'),
    )
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(events).toHaveLength(beforeInternalWrite)

    await writeFile(
      join(projectPath, 'opened.md'),
      '# overwritten externally\n',
    )
    await waitForEvents(events, beforeInternalWrite + 1)
    expect(events.at(-1)).toMatchObject({
      path: 'opened.md',
      source: 'external',
    })

    await versions.flush(projectPath)
    await monitor.closeAll()
  })
})
