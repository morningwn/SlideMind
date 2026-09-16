import { lstat } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron'
import type { ExportMarkdownWordResult } from '../../shared/document-export'
import type { ProjectRootRegistry } from '../project/project-root-registry'
import type { MarkdownWordExportService } from './markdown-word-export-service'
import { defaultWordSavePath, ensureDocxOutputPath } from './word-export-path'

function isAllowedApplicationUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (process.env.ELECTRON_RENDERER_URL) {
      return url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    }
    return (
      url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html')
    )
  } catch {
    return false
  }
}

function trustedWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (
    !window ||
    event.senderFrame !== event.sender.mainFrame ||
    !isAllowedApplicationUrl(event.sender.getURL())
  ) {
    throw new Error('拒绝来自未知页面的 Word 导出请求')
  }
  return window
}

export function registerDocumentExportIpc(
  service: MarkdownWordExportService,
  projectRoots: ProjectRootRegistry,
): void {
  const trackedSenders = new Set<number>()
  ipcMain.handle(
    'document-export:word',
    async (
      event,
      projectHandle: unknown,
      input: unknown,
    ): Promise<ExportMarkdownWordResult> => {
      const owner = trustedWindow(event)
      if (!trackedSenders.has(event.sender.id)) {
        trackedSenders.add(event.sender.id)
        event.sender.once('destroyed', () => {
          trackedSenders.delete(event.sender.id)
          service.cancelOwner(owner.id)
        })
      }
      if (service.isBusy(owner.id)) {
        return {
          status: 'failed',
          code: 'busy',
          message: '已有 Word 导出任务正在进行',
        }
      }
      if (typeof projectHandle !== 'string') {
        return {
          status: 'failed',
          code: 'invalid_input',
          message: '项目授权无效',
        }
      }
      let projectPath: string
      try {
        projectPath = projectRoots.resolve(projectHandle)
      } catch (error) {
        return {
          status: 'failed',
          code: 'source_unavailable',
          message: error instanceof Error ? error.message : '项目授权已失效',
        }
      }
      const path =
        input && typeof input === 'object'
          ? (input as { path?: unknown }).path
          : undefined
      if (
        typeof path !== 'string' ||
        !path.trim() ||
        path.length > 4096 ||
        path.includes('\0') ||
        !/\.(?:md|markdown)$/i.test(path)
      ) {
        return {
          status: 'failed',
          code: 'invalid_input',
          message: 'Markdown 文档路径无效',
        }
      }

      const selection = await dialog.showSaveDialog(owner, {
        title: '导出 Word',
        buttonLabel: '导出',
        defaultPath: defaultWordSavePath(app.getPath('desktop'), path),
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      })
      if (selection.canceled || !selection.filePath)
        return { status: 'canceled' }

      const outputPath = ensureDocxOutputPath(selection.filePath)
      if (outputPath !== selection.filePath) {
        let targetExists: boolean
        try {
          targetExists = await lstat(outputPath).then(
            () => true,
            (error) => {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                return false
              throw error
            },
          )
        } catch {
          return {
            status: 'failed',
            code: 'output_failed',
            message: '无法检查 Word 导出目标',
          }
        }
        if (targetExists) {
          const confirmation = await dialog.showMessageBox(owner, {
            type: 'warning',
            buttons: ['替换', '取消'],
            defaultId: 1,
            cancelId: 1,
            title: '替换现有 Word 文档？',
            message: '添加 .docx 后缀后的文件已存在，是否替换？',
          })
          if (confirmation.response !== 0) return { status: 'canceled' }
        }
      }

      return service.export(
        projectPath,
        projectHandle,
        input,
        outputPath,
        owner.id,
      )
    },
  )
}
