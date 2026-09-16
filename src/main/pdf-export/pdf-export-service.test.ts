import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  render: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {},
  screen: { getPrimaryDisplay: () => ({ scaleFactor: 1 }) },
  session: {},
}))
vi.mock('../presentation/presentation-store', () => ({
  ProjectPresentationStore: class {
    read = mocks.read
  },
}))
vi.mock('../presentation/presentation-renderer', () => ({
  renderPresentationSlidesIncrementally: mocks.render,
}))
vi.mock('../logging/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
  registerSensitivePath: vi.fn(),
}))

import { PdfExportService, gifFrameCount } from './pdf-export-service'

const directories: string[] = []
afterEach(async () => {
  mocks.read.mockReset()
  mocks.render.mockReset()
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

function pendingRender(): void {
  mocks.read.mockResolvedValue({
    document: {
      presentation: {
        slides: [{ id: 'slide-1' }],
        viewportRatio: 0.5625,
      },
    },
  })
  mocks.render.mockImplementation(
    (
      _presentation: unknown,
      _start: number,
      _end: number,
      _consume: unknown,
      signal: AbortSignal,
    ) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('canceled')), {
          once: true,
        })
      }),
  )
}

describe('PdfExportService lifecycle', () => {
  it('accepts a single-frame GIF and identifies animation', () => {
    const staticGif = Buffer.from(
      'R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
      'base64',
    )
    expect(gifFrameCount(staticGif)).toBe(1)
    const animatedGif = Buffer.concat([
      staticGif.subarray(0, -1),
      staticGif.subarray(13),
    ])
    expect(gifFrameCount(animatedGif)).toBe(2)
  })

  it('cancels a running render and removes its temporary file on close', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-pdf-service-'))
    directories.push(directory)
    pendingRender()
    const service = new PdfExportService()
    const result = service.exportPresentation(
      directory,
      'handle',
      { path: 'deck.slides.json' },
      join(directory, 'deck.pdf'),
      7,
    )
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalled())
    expect(service.isBusy(7)).toBe(true)
    await service.close()
    await expect(result).resolves.toMatchObject({
      status: 'failed',
      message: 'PDF 导出已取消或超时',
    })
    expect(await readdir(directory)).toEqual([])
    expect(service.isBusy(7)).toBe(false)
  })

  it('times out stalled rendering and removes the incomplete output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-pdf-service-'))
    directories.push(directory)
    pendingRender()
    const service = new PdfExportService(undefined, 50)
    const result = await service.exportPresentation(
      directory,
      'handle',
      { path: 'deck.slides.json' },
      join(directory, 'deck.pdf'),
      7,
    )
    expect(result).toMatchObject({
      status: 'failed',
      message: 'PDF 导出已取消或超时',
    })
    expect(await readdir(directory)).toEqual([])
  })
})
