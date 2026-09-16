import { lstat, realpath } from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { DocumentExportError } from './errors'

const INTERNAL_PROJECT_DIRECTORY = '.slidemind'

export function defaultWordSavePath(
  desktopPath: string,
  markdownPath: string,
): string {
  const name = basename(markdownPath, extname(markdownPath))
  return join(desktopPath, `${name}.docx`)
}

export function ensureDocxOutputPath(path: string): string {
  return path.toLocaleLowerCase().endsWith('.docx') ? path : `${path}.docx`
}

function isInside(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`)
}

export async function resolveWordOutputPath(
  projectPathInput: string,
  outputPathInput: string,
): Promise<{ outputPath: string; projectRelativePath?: string }> {
  if (
    !outputPathInput.trim() ||
    outputPathInput.length > 4096 ||
    outputPathInput.includes('\0') ||
    !isAbsolute(outputPathInput) ||
    !outputPathInput.toLocaleLowerCase().endsWith('.docx')
  ) {
    throw new DocumentExportError('invalid_input', 'Word 导出路径无效')
  }

  const projectPath = await realpath(projectPathInput)
  const requestedPath = resolve(outputPathInput)
  const parentPath = await realpath(dirname(requestedPath)).catch((error) => {
    throw new DocumentExportError('output_failed', 'Word 导出目录不可用', {
      cause: error,
    })
  })
  const outputPath = resolve(parentPath, basename(requestedPath))
  if (
    isInside(projectPath, requestedPath) &&
    !isInside(projectPath, outputPath)
  ) {
    throw new DocumentExportError(
      'output_failed',
      'Word 导出路径不能包含符号链接',
    )
  }
  const projectRelativePath = isInside(projectPath, outputPath)
    ? relative(projectPath, outputPath)
    : undefined

  if (projectRelativePath !== undefined) {
    if (
      projectRelativePath
        .split(sep)
        .some(
          (segment) =>
            segment.toLocaleLowerCase() === INTERNAL_PROJECT_DIRECTORY,
        )
    ) {
      throw new DocumentExportError(
        'output_failed',
        '不能导出到 SlideMind 内部目录',
      )
    }
    const relativeParent = relative(projectPath, parentPath)
    let currentPath = projectPath
    for (const segment of relativeParent ? relativeParent.split(sep) : []) {
      currentPath = resolve(currentPath, segment)
      if ((await lstat(currentPath)).isSymbolicLink()) {
        throw new DocumentExportError(
          'output_failed',
          'Word 导出路径不能包含符号链接',
        )
      }
    }
  }

  try {
    const existing = await lstat(outputPath)
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new DocumentExportError(
        'output_failed',
        'Word 导出目标必须是普通文件',
      )
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  return {
    outputPath,
    ...(projectRelativePath === undefined ? {} : { projectRelativePath }),
  }
}
