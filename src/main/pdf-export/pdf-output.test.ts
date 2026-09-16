import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PDFDocument from 'pdfkit'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commitPdf,
  ensurePdfPath,
  outputRevision,
  resolvePdfOutputPath,
  validatePdf,
} from './pdf-output'

const directories: string[] = []

async function fixture(): Promise<{ project: string; outside: string }> {
  const root = await mkdtemp(join(tmpdir(), 'slidemind-pdf-test-'))
  directories.push(root)
  const project = join(root, 'project')
  const outside = join(root, 'outside')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(project)
  await mkdir(outside)
  return { project, outside }
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('PDF output', () => {
  it('corrects the suffix and rejects project internal or linked output paths', async () => {
    const { project, outside } = await fixture()
    expect(ensurePdfPath('报告')).toBe('报告.pdf')
    expect(ensurePdfPath('报告.PDF')).toBe('报告.PDF')
    const output = await resolvePdfOutputPath(
      project,
      join(project, '报告.pdf'),
    )
    expect(output.projectRelativePath).toBe('报告.pdf')
    await symlink(outside, join(project, 'linked'))
    await expect(
      resolvePdfOutputPath(project, join(project, 'linked', 'report.pdf')),
    ).rejects.toThrow()
    await symlink(join(outside, 'target.pdf'), join(project, 'target.pdf'))
    await expect(
      resolvePdfOutputPath(project, join(project, 'target.pdf')),
    ).rejects.toThrow()
  })

  it('preserves an existing target changed while rendering', async () => {
    const { project } = await fixture()
    const target = join(project, 'report.pdf')
    const pending = join(project, 'pending.tmp')
    await writeFile(target, 'original')
    const initial = await outputRevision(target)
    await writeFile(pending, 'new pdf')
    await writeFile(target, 'edited after export started')
    await expect(commitPdf(target, pending, initial)).rejects.toThrow(
      '已被其他程序修改',
    )
    expect(await readFile(target, 'utf8')).toBe('edited after export started')
  })

  it('checks the generated PDF signature and exact page count', async () => {
    const { project } = await fixture()
    const path = join(project, 'generated.pdf')
    const doc = new PDFDocument({ autoFirstPage: false })
    const stream = createWriteStream(path)
    doc.pipe(stream)
    doc.addPage().text('first')
    doc.addPage().text('second')
    doc.end()
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve)
      stream.once('error', reject)
    })
    expect(await validatePdf(path, 2, 792 / 612)).toBe(2)
    await expect(validatePdf(path, 1)).rejects.toThrow('页数无效')
    await expect(validatePdf(path, 2, 0.5625)).rejects.toThrow('比例无效')
  })
})
