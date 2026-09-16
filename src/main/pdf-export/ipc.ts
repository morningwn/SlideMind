import { lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { URL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron'
import type { PdfExportResult } from '../../shared/pdf-export'
import type { ProjectRootRegistry } from '../project/project-root-registry'
import { ensurePdfPath } from './pdf-output'
import type { PdfExportService } from './pdf-export-service'

function trustedWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender)
  let allowed = false
  try {
    const url = new URL(event.sender.getURL())
    allowed = process.env.ELECTRON_RENDERER_URL
      ? url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
      : url.protocol === 'file:' &&
        url.pathname.endsWith('/renderer/index.html')
  } catch {
    /* invalid URL */
  }
  if (!owner || event.senderFrame !== event.sender.mainFrame || !allowed) {
    throw new Error('拒绝来自未知页面的 PDF 导出请求')
  }
  return owner
}

async function chooseOutput(
  owner: BrowserWindow,
  path: string,
): Promise<string | null> {
  const selection = await dialog.showSaveDialog(owner, {
    title: '导出 PDF',
    buttonLabel: '导出',
    defaultPath: join(
      app.getPath('desktop'),
      `${path.toLocaleLowerCase().endsWith('.slides.json') ? basename(path, '.slides.json') : basename(path, extname(path))}.pdf`,
    ),
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (selection.canceled || !selection.filePath) return null
  const outputPath = ensurePdfPath(selection.filePath)
  if (outputPath !== selection.filePath) {
    const existing = await lstat(outputPath).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      },
    )
    if (existing) {
      const confirmation = await dialog.showMessageBox(owner, {
        type: 'warning',
        buttons: ['替换', '取消'],
        defaultId: 1,
        cancelId: 1,
        title: '替换现有 PDF？',
        message: '添加 .pdf 后缀后的文件已存在，是否替换？',
      })
      if (confirmation.response !== 0) return null
    }
  }
  return outputPath
}

export function registerPdfExportIpc(
  service: PdfExportService,
  roots: ProjectRootRegistry,
): void {
  const tracked = new Set<number>()
  for (const kind of ['markdown', 'presentation'] as const) {
    ipcMain.handle(
      `pdf-export:${kind}`,
      async (
        event: IpcMainInvokeEvent,
        projectHandle: unknown,
        input: unknown,
      ): Promise<PdfExportResult> => {
        const owner = trustedWindow(event)
        if (!tracked.has(event.sender.id)) {
          tracked.add(event.sender.id)
          event.sender.once('destroyed', () => {
            tracked.delete(event.sender.id)
            service.cancelOwner(owner.id)
          })
        }
        if (service.isBusy(owner.id))
          return { status: 'failed', message: '已有 PDF 导出任务正在进行' }
        if (typeof projectHandle !== 'string')
          return { status: 'failed', message: '项目授权无效' }
        let projectPath: string
        try {
          projectPath = roots.resolve(projectHandle)
        } catch {
          return { status: 'failed', message: '项目授权已失效' }
        }
        const path =
          input && typeof input === 'object'
            ? (input as { path?: unknown }).path
            : undefined
        const valid =
          typeof path === 'string' &&
          !!path.trim() &&
          path.length <= 4096 &&
          !path.includes('\0') &&
          (kind === 'markdown'
            ? /\.(?:md|markdown)$/i
            : /\.slides\.json$/i
          ).test(path)
        if (!valid) return { status: 'failed', message: 'PDF 导出源路径无效' }
        if (
          kind === 'markdown' &&
          (typeof (input as { content?: unknown }).content !== 'string' ||
            Buffer.byteLength((input as { content: string }).content, 'utf8') >
              2 * 1024 * 1024)
        )
          return { status: 'failed', message: 'Markdown 内容无效或超过 2 MiB' }
        try {
          const outputPath = await chooseOutput(owner, path)
          if (!outputPath) return { status: 'canceled' }
          return kind === 'markdown'
            ? service.exportMarkdown(
                projectPath,
                projectHandle,
                input,
                outputPath,
                owner.id,
              )
            : service.exportPresentation(
                projectPath,
                projectHandle,
                input,
                outputPath,
                owner.id,
              )
        } catch (error) {
          return {
            status: 'failed',
            message: error instanceof Error ? error.message : 'PDF 导出失败',
          }
        }
      },
    )
  }
}
