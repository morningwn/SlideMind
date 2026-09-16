import { constants } from 'node:fs'
import { access, mkdir, writeFile } from 'node:fs/promises'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { FilePolicy } from './file-policy'
import type { ProjectMutationService } from '../version-control/project-mutation-service'
import { downloadAsset, resolveDownloadTarget } from './download-asset'

export function createProjectMutationToolsExtension(options: {
  mutations: ProjectMutationService
  projectHandle: string
  projectPath: string
  filePolicy?: FilePolicy
}): ExtensionFactory {
  return async (pi) => {
    const policy =
      options.filePolicy ?? (await FilePolicy.create(options.projectPath))
    const {
      createEditTool,
      createReadTool,
      createWriteTool,
      detectSupportedImageMimeTypeFromFile,
    } = await import('@earendil-works/pi-coding-agent')
    const { Type } = await import('@earendil-works/pi-ai')
    const write = async (
      absolutePath: string,
      content: string,
    ): Promise<void> => {
      await policy.resolve(absolutePath, 'write', 'file', true)
      await options.mutations.run(
        {
          projectPath: options.projectPath,
          projectHandle: options.projectHandle,
          paths: [absolutePath],
          source: 'agent',
        },
        async () => {
          await policy.resolve(absolutePath, 'write', 'file', true)
          await writeFile(absolutePath, content)
        },
      )
    }

    const editTool = createEditTool(options.projectPath, {
      operations: {
        access: async (path) => {
          await policy.resolve(path, 'write')
          await access(path, constants.R_OK | constants.W_OK)
        },
        readFile: (path) => policy.readFile(path),
        writeFile: write,
      },
    })
    pi.registerTool({
      name: 'edit',
      label: 'edit',
      description: editTool.description,
      parameters: editTool.parameters,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const path = await policy.resolve(params.path, 'write')
        return editTool.execute(
          toolCallId,
          { ...params, path },
          signal,
          onUpdate,
        )
      },
    })

    const writeTool = createWriteTool(options.projectPath, {
      operations: {
        mkdir: async (path) => {
          await policy.resolve(path, 'write', 'directory', true)
          await mkdir(path, { recursive: true })
        },
        writeFile: write,
      },
    })
    pi.registerTool({
      name: 'write',
      label: 'write',
      description: writeTool.description,
      parameters: writeTool.parameters,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const path = await policy.resolve(params.path, 'write', 'file', true)
        return writeTool.execute(
          toolCallId,
          { ...params, path },
          signal,
          onUpdate,
        )
      },
    })

    const readTool = createReadTool(options.projectPath, {
      operations: {
        access: async (path) => {
          await policy.resolve(path, 'read')
        },
        readFile: (path) => policy.readFile(path),
        detectImageMimeType: async (path) => {
          await policy.resolve(path, 'read')
          return detectSupportedImageMimeTypeFromFile(path)
        },
      },
    })
    pi.registerTool({
      name: 'read',
      label: 'read',
      description: readTool.description,
      parameters: readTool.parameters,
      execute: async (id, params, signal, update) => {
        const path = await policy.resolve(params.path, 'read')
        return readTool.execute(id, { ...params, path }, signal, update)
      },
    })
    const previewTool = createReadTool(options.projectPath)
    pi.registerTool({
      name: 'download_asset',
      label: '下载素材',
      description: [
        '将公开 HTTPS 地址的 PNG、JPEG、GIF、WebP 图片或 UTF-8 文本原样下载到当前项目。',
        'path 必须是项目内相对路径；图片最大 20 MiB，文本最大 2 MiB。',
        '工具会阻止私网、保留地址、符号链接逃逸、不安全重定向和非 HTTPS 地址。',
      ].join(' '),
      promptSnippet:
        'Download a public HTTPS image or UTF-8 text file into the project.',
      promptGuidelines: [
        'Use download_asset when the original image or text bytes must be saved; use fetch_content when only readable web content is needed.',
        'After downloading text, use read on the saved path before relying on its contents.',
      ],
      parameters: Type.Object(
        {
          url: Type.String({ minLength: 1, maxLength: 8192 }),
          path: Type.String({ minLength: 1, maxLength: 4096 }),
          kind: Type.Union([Type.Literal('image'), Type.Literal('text')]),
        },
        { additionalProperties: false },
      ),
      async execute(toolCallId, params, signal) {
        await policy.resolve(params.path, 'write', 'file', true)
        const target = await resolveDownloadTarget(
          options.projectPath,
          params.path,
        )
        let imagePreview:
          | { data: string; mimeType: string; type: 'image' }
          | undefined
        const result = await options.mutations.run(
          {
            projectPath: options.projectPath,
            projectHandle: options.projectHandle,
            paths: [target.targetPath],
            source: 'agent',
          },
          () =>
            downloadAsset({
              ...params,
              projectPath: options.projectPath,
              signal,
              validateImage:
                params.kind === 'image'
                  ? async (path) => {
                      const preview = await previewTool.execute(
                        `${toolCallId}:preview`,
                        { path },
                        signal,
                        undefined,
                      )
                      const image = preview.content.find(
                        (block) => block.type === 'image',
                      )
                      if (!image) throw new Error('下载内容不是受支持的图片')
                      imagePreview = image
                    }
                  : undefined,
            }),
        )

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  path: result.path,
                  kind: params.kind,
                  bytes: result.bytes,
                  contentType: result.contentType,
                  source: result.finalUrl,
                },
                null,
                2,
              ),
            },
            ...(imagePreview ? [imagePreview] : []),
          ],
          details: result,
        }
      },
    })
  }
}
