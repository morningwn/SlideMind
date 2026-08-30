import { constants } from 'node:fs'
import {
  access,
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises'
import {
  createEditTool,
  createWriteTool,
  type ExtensionFactory
} from '@earendil-works/pi-coding-agent'
import type { ProjectMutationService } from '../version-control/project-mutation-service'

export function createProjectMutationToolsExtension(options: {
  mutations: ProjectMutationService
  projectHandle: string
  projectPath: string
}): ExtensionFactory {
  return async (pi) => {
    const write = async (absolutePath: string, content: string): Promise<void> => {
      await options.mutations.run(
        {
          projectPath: options.projectPath,
          projectHandle: options.projectHandle,
          paths: [absolutePath],
          source: 'agent'
        },
        () => writeFile(absolutePath, content)
      )
    }

    const editTool = createEditTool(options.projectPath, {
      operations: {
        access: (path) => access(path, constants.R_OK | constants.W_OK),
        readFile,
        writeFile: write
      }
    })
    pi.registerTool({
      name: 'edit',
      label: 'edit',
      description: editTool.description,
      parameters: editTool.parameters,
      execute: (toolCallId, params, signal, onUpdate) =>
        editTool.execute(toolCallId, params, signal, onUpdate)
    })

    const writeTool = createWriteTool(options.projectPath, {
      operations: {
        mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
        writeFile: write
      }
    })
    pi.registerTool({
      name: 'write',
      label: 'write',
      description: writeTool.description,
      parameters: writeTool.parameters,
      execute: (toolCallId, params, signal, onUpdate) =>
        writeTool.execute(toolCallId, params, signal, onUpdate)
    })
  }
}
