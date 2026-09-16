import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    app: { getPath: vi.fn(() => '/Desktop') },
    dialog: {
      showMessageBox: vi.fn(),
      showSaveDialog: vi.fn(),
    },
    fromWebContents: vi.fn(),
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler)
        },
      ),
    },
  }
})

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: { fromWebContents: electron.fromWebContents },
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
}))

import { registerDocumentExportIpc } from './ipc'
import type { MarkdownWordExportService } from './markdown-word-export-service'
import type { ProjectRootRegistry } from '../project/project-root-registry'

function event(url = 'http://localhost:5173/'): Record<string, unknown> {
  const mainFrame = {}
  return {
    senderFrame: mainFrame,
    sender: {
      getURL: () => url,
      id: 10,
      mainFrame,
      once: vi.fn(),
    },
  }
}

describe('document export IPC', () => {
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    electron.handlers.clear()
    electron.fromWebContents.mockReset()
    electron.dialog.showSaveDialog.mockReset()
    electron.dialog.showMessageBox.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects calls that do not come from the application main frame', async () => {
    const service = {
      isBusy: vi.fn(() => false),
    } as unknown as MarkdownWordExportService
    registerDocumentExportIpc(service, {} as ProjectRootRegistry)
    const handler = electron.handlers.get('document-export:word')!
    const ipcEvent = event()
    electron.fromWebContents.mockReturnValue({ id: 1 })
    ipcEvent.senderFrame = {}

    await expect(
      handler(ipcEvent, 'handle', { path: 'notes.md', content: '# x' }),
    ).rejects.toThrow('未知页面')
  })

  it('returns canceled without starting conversion when the save dialog is canceled', async () => {
    const owner = { id: 1 }
    const service = {
      cancelOwner: vi.fn(),
      export: vi.fn(),
      isBusy: vi.fn(() => false),
    } as unknown as MarkdownWordExportService
    const projectRoots = {
      resolve: vi.fn(() => '/project'),
    } as unknown as ProjectRootRegistry
    electron.fromWebContents.mockReturnValue(owner)
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true })
    registerDocumentExportIpc(service, projectRoots)
    const handler = electron.handlers.get('document-export:word')!

    await expect(
      handler(event(), 'handle', { path: 'docs/notes.md', content: '# x' }),
    ).resolves.toEqual({ status: 'canceled' })
    expect(electron.dialog.showSaveDialog).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ defaultPath: '/Desktop/notes.docx' }),
    )
    expect(service.export).not.toHaveBeenCalled()
  })

  it('rejects duplicate work before opening another save dialog', async () => {
    const service = {
      cancelOwner: vi.fn(),
      isBusy: vi.fn(() => true),
    } as unknown as MarkdownWordExportService
    electron.fromWebContents.mockReturnValue({ id: 1 })
    registerDocumentExportIpc(service, {} as ProjectRootRegistry)
    const handler = electron.handlers.get('document-export:word')!

    await expect(
      handler(event(), 'handle', { path: 'notes.md', content: '# x' }),
    ).resolves.toMatchObject({ status: 'failed', code: 'busy' })
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled()
  })

  it('returns a finite failure for an expired project handle', async () => {
    const service = {
      cancelOwner: vi.fn(),
      isBusy: vi.fn(() => false),
    } as unknown as MarkdownWordExportService
    const projectRoots = {
      resolve: vi.fn(() => {
        throw new Error('项目授权已失效')
      }),
    } as unknown as ProjectRootRegistry
    electron.fromWebContents.mockReturnValue({ id: 1 })
    registerDocumentExportIpc(service, projectRoots)
    const handler = electron.handlers.get('document-export:word')!

    await expect(
      handler(event(), 'expired', { path: 'notes.md', content: '# x' }),
    ).resolves.toEqual({
      status: 'failed',
      code: 'source_unavailable',
      message: '项目授权已失效',
    })
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled()
  })

  it('confirms the actual suffixed target before overwriting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-export-ipc-'))
    const selectedPath = join(directory, 'notes')
    await writeFile(`${selectedPath}.docx`, 'existing')
    const owner = { id: 1 }
    const service = {
      cancelOwner: vi.fn(),
      export: vi.fn(),
      isBusy: vi.fn(() => false),
    } as unknown as MarkdownWordExportService
    const projectRoots = {
      resolve: vi.fn(() => '/project'),
    } as unknown as ProjectRootRegistry
    electron.fromWebContents.mockReturnValue(owner)
    electron.dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: selectedPath,
    })
    electron.dialog.showMessageBox.mockResolvedValue({ response: 1 })
    registerDocumentExportIpc(service, projectRoots)
    const handler = electron.handlers.get('document-export:word')!

    await expect(
      handler(event(), 'handle', { path: 'notes.md', content: '# x' }),
    ).resolves.toEqual({ status: 'canceled' })
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ message: expect.stringContaining('.docx') }),
    )
    expect(service.export).not.toHaveBeenCalled()
    await rm(directory, { recursive: true, force: true })
  })
})
