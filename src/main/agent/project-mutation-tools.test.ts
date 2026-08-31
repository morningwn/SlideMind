import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import type { ProjectMutationService } from '../version-control/project-mutation-service'
import { createProjectMutationToolsExtension } from './project-mutation-tools'

describe('createProjectMutationToolsExtension', () => {
  it('registers the managed downloader alongside versioned file tools', async () => {
    const toolNames: string[] = []
    const extension = createProjectMutationToolsExtension({
      mutations: {} as ProjectMutationService,
      projectHandle: 'project-handle',
      projectPath: process.cwd()
    })

    await extension({
      registerTool: (tool: { name: string }) => {
        toolNames.push(tool.name)
      }
    } as unknown as ExtensionAPI)

    expect(toolNames).toEqual(['edit', 'write', 'download_asset'])
  })
})
