import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defaultWordSavePath,
  ensureDocxOutputPath,
  resolveWordOutputPath,
} from './word-export-path'

describe('Word export paths', () => {
  it('builds a desktop default and normalizes the extension', () => {
    expect(defaultWordSavePath('/Desktop', 'docs/季度复盘.markdown')).toBe(
      join('/Desktop', '季度复盘.docx'),
    )
    expect(ensureDocxOutputPath('/Desktop/report')).toBe('/Desktop/report.docx')
    expect(ensureDocxOutputPath('/Desktop/report.DOCX')).toBe(
      '/Desktop/report.DOCX',
    )
  })

  it('identifies outputs inside the project for version tracking', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-word-path-'))
    await mkdir(join(projectPath, 'exports'))

    await expect(
      resolveWordOutputPath(
        projectPath,
        join(projectPath, 'exports', 'report.docx'),
      ),
    ).resolves.toMatchObject({
      projectRelativePath: join('exports', 'report.docx'),
    })
  })

  it('rejects internal directories and symbolic-link targets', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-word-path-'))
    const outsidePath = await mkdtemp(
      join(tmpdir(), 'slidemind-word-path-outside-'),
    )
    await mkdir(join(projectPath, '.slideMind'))
    await writeFile(join(outsidePath, 'existing.docx'), 'x')
    await symlink(
      join(outsidePath, 'existing.docx'),
      join(projectPath, 'linked.docx'),
    )

    await expect(
      resolveWordOutputPath(
        projectPath,
        join(projectPath, '.slideMind', 'private.docx'),
      ),
    ).rejects.toThrow('内部目录')
    await expect(
      resolveWordOutputPath(projectPath, join(projectPath, 'linked.docx')),
    ).rejects.toThrow('普通文件')
  })
})
