import { basename, join } from 'node:path'
import { defaultPresentationOutputPath, isPptxPath } from './presentation-store'

export function defaultPresentationSavePath(desktopPath: string, presentationPath: string): string {
  return join(desktopPath, defaultPresentationOutputPath(basename(presentationPath)))
}

export function ensurePptxOutputPath(path: string): string {
  return isPptxPath(path) ? path : `${path}.pptx`
}
