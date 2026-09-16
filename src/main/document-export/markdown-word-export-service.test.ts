import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownWordExportService } from './markdown-word-export-service'
import { PandocRuntime } from './pandoc-runtime'
import type { ProjectMutationService } from '../version-control/project-mutation-service'
import { DocumentExportError } from './errors'

const document = {
  'pandoc-api-version': [1, 23],
  meta: {},
  blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'snapshot' }] }],
}
const docxBytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('[Content_Types].xml word/document.xml'),
])

describe('MarkdownWordExportService', () => {
  it('exports the supplied snapshot and records project-local output mutations', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-word-service-'))
    await writeFile(join(projectPath, 'notes.md'), '# on disk')
    const parseMarkdown = vi.fn().mockResolvedValue(document)
    const runtime = {
      parseMarkdown,
      writeDocx: vi.fn(async (_document: unknown, path: string) =>
        writeFile(path, docxBytes),
      ),
      cancel: vi.fn(),
      close: vi.fn(),
    } as unknown as PandocRuntime
    const run = vi.fn(
      async (_input: unknown, operation: () => Promise<unknown>) => operation(),
    )
    const mutations = { run } as unknown as ProjectMutationService
    const service = new MarkdownWordExportService(runtime, mutations)

    const result = await service.export(
      projectPath,
      'project-handle',
      { path: 'notes.md', content: '# unsaved snapshot' },
      join(projectPath, 'notes.docx'),
      1,
    )

    expect(result).toMatchObject({ status: 'exported', warnings: [] })
    expect(parseMarkdown).toHaveBeenCalledWith(
      '# unsaved snapshot',
      expect.any(String),
      expect.any(AbortSignal),
    )
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ['notes.docx'], source: 'text-editor' }),
      expect.any(Function),
    )
    expect(await readFile(join(projectPath, 'notes.docx'))).toEqual(docxBytes)
  })

  it('preserves an output that changes while conversion is running', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-word-service-'))
    const exportPath = join(projectPath, 'notes.docx')
    await writeFile(join(projectPath, 'notes.md'), '# notes')
    await writeFile(exportPath, 'original')
    const runtime = {
      parseMarkdown: vi.fn().mockResolvedValue(document),
      writeDocx: vi.fn(async (_document: unknown, path: string) => {
        await writeFile(path, docxBytes)
        await writeFile(exportPath, 'external change')
      }),
      cancel: vi.fn(),
      close: vi.fn(),
    } as unknown as PandocRuntime
    const service = new MarkdownWordExportService(runtime)

    await expect(
      service.export(
        projectPath,
        'project-handle',
        { path: 'notes.md', content: '# snapshot' },
        exportPath,
        1,
      ),
    ).resolves.toMatchObject({ status: 'failed', code: 'output_changed' })
    expect(await readFile(exportPath, 'utf8')).toBe('external change')
  })

  it('preserves an existing output when generated DOCX validation fails', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-word-service-'))
    const exportPath = join(projectPath, 'notes.docx')
    await writeFile(join(projectPath, 'notes.md'), '# notes')
    await writeFile(exportPath, 'original')
    const runtime = {
      parseMarkdown: vi.fn().mockResolvedValue(document),
      writeDocx: vi.fn(async (_document: unknown, path: string) =>
        writeFile(path, 'invalid docx'),
      ),
      cancel: vi.fn(),
      close: vi.fn(),
    } as unknown as PandocRuntime
    const service = new MarkdownWordExportService(runtime)

    await expect(
      service.export(
        projectPath,
        'project-handle',
        { path: 'notes.md', content: '# snapshot' },
        exportPath,
        1,
      ),
    ).resolves.toMatchObject({ status: 'failed', code: 'conversion_failed' })
    expect(await readFile(exportPath, 'utf8')).toBe('original')
  })

  it('does not record external outputs as project mutations', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-word-service-'))
    const outputDirectory = await mkdtemp(
      join(tmpdir(), 'slidemind-word-service-output-'),
    )
    await writeFile(join(projectPath, 'notes.md'), '# notes')
    const runtime = {
      parseMarkdown: vi.fn().mockResolvedValue(document),
      writeDocx: vi.fn(async (_document: unknown, path: string) =>
        writeFile(path, docxBytes),
      ),
      cancel: vi.fn(),
      close: vi.fn(),
    } as unknown as PandocRuntime
    const run = vi.fn()
    const service = new MarkdownWordExportService(runtime, {
      run,
    } as unknown as ProjectMutationService)
    const outputPath = join(await realpath(outputDirectory), 'notes.docx')

    await expect(
      service.export(
        projectPath,
        'project-handle',
        { path: 'notes.md', content: '# snapshot' },
        outputPath,
        1,
      ),
    ).resolves.toMatchObject({ status: 'exported', outputPath })
    expect(run).not.toHaveBeenCalled()
    expect(await readFile(outputPath)).toEqual(docxBytes)
  })

  it('reports missing runtime and oversized input as finite business failures', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-word-service-'))
    await writeFile(join(projectPath, 'notes.md'), '# notes')
    const service = new MarkdownWordExportService(
      new PandocRuntime({
        binaryPath: join(projectPath, 'missing-pandoc'),
        referencePath: join(projectPath, 'missing-reference.docx'),
      }),
    )

    await expect(
      service.export(
        projectPath,
        'project-handle',
        { path: 'notes.md', content: 'x'.repeat(2 * 1024 * 1024 + 1) },
        join(projectPath, 'notes.docx'),
        1,
      ),
    ).resolves.toMatchObject({ status: 'failed', code: 'input_too_large' })
    await expect(
      service.export(
        projectPath,
        'project-handle',
        { path: 'notes.md', content: '# snapshot' },
        join(projectPath, 'notes.docx'),
        1,
      ),
    ).resolves.toMatchObject({ status: 'failed', code: 'runtime_unavailable' })
  })

  it('rejects duplicate work and cancels conversion when its window closes', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-word-service-'))
    await writeFile(join(projectPath, 'notes.md'), '# notes')
    const cancel = vi.fn()
    const runtime = {
      parseMarkdown: vi.fn(
        (_markdown: string, _operationId: string, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            if (signal.aborted) {
              reject(
                new DocumentExportError('conversion_failed', 'Word 导出已取消'),
              )
              return
            }
            signal.addEventListener(
              'abort',
              () =>
                reject(
                  new DocumentExportError(
                    'conversion_failed',
                    'Word 导出已取消',
                  ),
                ),
              { once: true },
            )
          }),
      ),
      cancel,
      close: vi.fn(),
    } as unknown as PandocRuntime
    const service = new MarkdownWordExportService(runtime)
    const first = service.export(
      projectPath,
      'project-handle',
      { path: 'notes.md', content: '# snapshot' },
      join(projectPath, 'notes.docx'),
      7,
    )
    await vi.waitFor(() => expect(service.isBusy(7)).toBe(true))

    await expect(
      service.export(
        projectPath,
        'project-handle',
        { path: 'notes.md', content: '# duplicate' },
        join(projectPath, 'duplicate.docx'),
        7,
      ),
    ).resolves.toMatchObject({ status: 'failed', code: 'busy' })
    service.cancelOwner(7)
    await expect(first).resolves.toMatchObject({
      status: 'failed',
      code: 'conversion_failed',
    })
    expect(cancel).toHaveBeenCalledOnce()
  })
})
