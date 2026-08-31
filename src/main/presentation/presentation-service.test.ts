import { mkdtemp, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePresentationOutputPath } from './presentation-service'

describe('resolvePresentationOutputPath', () => {
  it('accepts a user-selected absolute path outside the project', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-project-'))
    const exportDirectory = await mkdtemp(join(tmpdir(), 'slidemind-export-'))
    const outputPath = join(exportDirectory, 'deck.pptx')
    const resolvedExportDirectory = await realpath(exportDirectory)

    await expect(resolvePresentationOutputPath(projectPath, outputPath, true)).resolves.toEqual({
      outputPath: join(resolvedExportDirectory, 'deck.pptx'),
      resultPath: outputPath
    })
  })

  it('requires explicit authorization for an absolute output path', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-project-'))
    const exportDirectory = await mkdtemp(join(tmpdir(), 'slidemind-export-'))

    await expect(
      resolvePresentationOutputPath(projectPath, join(exportDirectory, 'deck.pptx'))
    ).rejects.toThrow('必须位于项目目录内')
  })

  it('keeps relative exports inside the project', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-project-'))
    const resolvedProjectPath = await realpath(projectPath)

    await expect(resolvePresentationOutputPath(projectPath, 'deck.pptx')).resolves.toEqual({
      outputPath: join(resolvedProjectPath, 'deck.pptx'),
      projectRelativePath: 'deck.pptx',
      resultPath: 'deck.pptx'
    })
  })

  it('rejects relative exports that escape through a symbolic link', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-project-'))
    const exportDirectory = await mkdtemp(join(tmpdir(), 'slidemind-export-'))
    await symlink(exportDirectory, join(projectPath, 'linked'))

    await expect(resolvePresentationOutputPath(projectPath, 'linked/deck.pptx')).rejects.toThrow(
      '超出项目范围'
    )
  })
})
