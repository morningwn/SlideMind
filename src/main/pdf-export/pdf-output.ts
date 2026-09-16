import { randomUUID } from 'node:crypto'
import {
  lstat,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'

const MAX_PDF_BYTES = 200 * 1024 * 1024

interface Revision {
  ctimeMs: number
  ino: number
  mtimeMs: number
  size: number
}

function isInside(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`)
}

export function ensurePdfPath(path: string): string {
  return path.toLocaleLowerCase().endsWith('.pdf') ? path : `${path}.pdf`
}

export async function outputRevision(path: string): Promise<Revision | null> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error('PDF 导出目标必须是普通文件')
    return {
      ctimeMs: info.ctimeMs,
      ino: info.ino,
      mtimeMs: info.mtimeMs,
      size: info.size,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function resolvePdfOutputPath(
  projectPathInput: string,
  selectedPath: string,
): Promise<{
  outputPath: string
  projectRelativePath?: string
}> {
  if (
    !selectedPath.trim() ||
    selectedPath.length > 4096 ||
    selectedPath.includes('\0') ||
    !isAbsolute(selectedPath) ||
    !selectedPath.toLocaleLowerCase().endsWith('.pdf')
  ) {
    throw new Error('PDF 导出路径无效')
  }
  const projectPath = await realpath(projectPathInput)
  const requestedPath = resolve(selectedPath)
  const parentPath = await realpath(dirname(requestedPath))
  const outputPath = resolve(parentPath, basename(requestedPath))
  if (
    (isInside(projectPath, requestedPath) ||
      isInside(resolve(projectPathInput), requestedPath)) &&
    !isInside(projectPath, outputPath)
  ) {
    throw new Error('PDF 导出路径不能包含符号链接')
  }
  const projectRelativePath = isInside(projectPath, outputPath)
    ? relative(projectPath, outputPath)
    : undefined
  if (projectRelativePath !== undefined) {
    if (
      projectRelativePath
        .split(sep)
        .some((part) => part.toLocaleLowerCase() === '.slidemind')
    ) {
      throw new Error('不能导出到 SlideMind 内部目录')
    }
    let currentPath = projectPath
    const relativeParent = relative(projectPath, parentPath)
    for (const part of relativeParent ? relativeParent.split(sep) : []) {
      currentPath = resolve(currentPath, part)
      if ((await lstat(currentPath)).isSymbolicLink())
        throw new Error('PDF 导出路径不能包含符号链接')
    }
  }
  await outputRevision(outputPath)
  return {
    outputPath,
    ...(projectRelativePath === undefined ? {} : { projectRelativePath }),
  }
}

export function temporaryPdfPath(outputPath: string): string {
  return `${outputPath}.${process.pid}-${randomUUID()}.slidemind-tmp`
}

export async function validatePdf(
  path: string,
  expectedPages?: number,
  expectedRatio?: number,
): Promise<number> {
  const file = await stat(path)
  if (!file.isFile() || file.size < 100 || file.size > MAX_PDF_BYTES)
    throw new Error('生成的 PDF 大小无效')
  const bytes = await readFile(path)
  const text = bytes.toString('latin1')
  if (!text.startsWith('%PDF-') || !text.slice(-1024).includes('%%EOF'))
    throw new Error('生成的 PDF 结构无效')
  const pages = [...text.matchAll(/\/Type\s*\/Page\b/g)].length
  if (pages < 1 || (expectedPages !== undefined && pages !== expectedPages)) {
    throw new Error('生成的 PDF 页数无效')
  }
  if (expectedRatio !== undefined) {
    const boxes = [
      ...text.matchAll(
        /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g,
      ),
    ]
    if (
      boxes.length !== pages ||
      boxes.some((box) => {
        const width = Number(box[3]) - Number(box[1])
        const height = Number(box[4]) - Number(box[2])
        return width <= 0 || Math.abs(height / width - expectedRatio) > 0.001
      })
    )
      throw new Error('生成的 PDF 页面比例无效')
  }
  return pages
}

export async function commitPdf(
  outputPath: string,
  temporaryPath: string,
  initial: Revision | null,
): Promise<void> {
  const current = await outputRevision(outputPath)
  if (JSON.stringify(initial) !== JSON.stringify(current))
    throw new Error('导出目标在转换期间已被其他程序修改')
  await rename(temporaryPath, outputPath)
}

export async function removeTemporaryPdf(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}
