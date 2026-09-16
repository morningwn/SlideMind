import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    fromWebContents: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => '/Desktop' },
  BrowserWindow: { fromWebContents: electron.fromWebContents },
  dialog: {
    showSaveDialog: electron.showSaveDialog,
    showMessageBox: electron.showMessageBox,
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    },
  },
}))

import { registerPdfExportIpc } from './ipc'
import type { PdfExportService } from './pdf-export-service'
import type { ProjectRootRegistry } from '../project/project-root-registry'

function event(): { sender: Record<string, unknown>; senderFrame: object } {
  const mainFrame = {}
  return {
    senderFrame: mainFrame,
    sender: {
      id: 4,
      mainFrame,
      getURL: () => 'http://localhost:5173/',
      once: vi.fn(),
    },
  }
}

const service = {
  isBusy: vi.fn(() => false),
  cancelOwner: vi.fn(),
  exportMarkdown: vi.fn(),
  exportPresentation: vi.fn(),
} as unknown as PdfExportService
const roots = {
  resolve: vi.fn(() => '/project'),
} as unknown as ProjectRootRegistry

describe('PDF export IPC', () => {
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    electron.handlers.clear()
    electron.fromWebContents.mockReturnValue({ id: 9 })
    electron.showSaveDialog.mockReset()
    electron.showMessageBox.mockReset()
    vi.mocked(service.isBusy).mockReturnValue(false)
    vi.mocked(service.exportMarkdown).mockReset()
    vi.mocked(service.exportPresentation).mockReset()
    registerPdfExportIpc(service, roots)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('rejects subframe calls before opening the save dialog', async () => {
    const incoming = event()
    incoming.senderFrame = {}
    await expect(
      electron.handlers.get('pdf-export:markdown')!(incoming, 'handle', {
        path: 'notes.md',
        content: '# x',
      }),
    ).rejects.toThrow('未知页面')
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
  })

  it('validates project authorization and source type at the boundary', async () => {
    const handler = electron.handlers.get('pdf-export:presentation')!
    await expect(
      handler(event(), 'handle', { path: 'foreign.pptx' }),
    ).resolves.toMatchObject({ status: 'failed' })
    await expect(
      handler(event(), null, { path: 'deck.slides.json' }),
    ).resolves.toMatchObject({ status: 'failed' })
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
  })

  it('does not launch rendering after a canceled dialog', async () => {
    electron.showSaveDialog.mockResolvedValue({ canceled: true })
    await expect(
      electron.handlers.get('pdf-export:markdown')!(event(), 'handle', {
        path: 'notes.md',
        content: '# x',
      }),
    ).resolves.toEqual({ status: 'canceled' })
    expect(service.exportMarkdown).not.toHaveBeenCalled()
  })

  it('confirms an existing target after correcting the PDF suffix', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-pdf-ipc-'))
    try {
      const selected = join(directory, 'notes')
      await writeFile(`${selected}.pdf`, 'old')
      electron.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: selected,
      })
      electron.showMessageBox.mockResolvedValue({ response: 1 })
      await expect(
        electron.handlers.get('pdf-export:markdown')!(event(), 'handle', {
          path: 'notes.md',
          content: '# x',
        }),
      ).resolves.toEqual({ status: 'canceled' })
      expect(electron.showMessageBox).toHaveBeenCalled()
      expect(service.exportMarkdown).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
