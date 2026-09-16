import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePandocRuntimeOptions } from './pandoc-runtime'

describe('resolvePandocRuntimeOptions', () => {
  it('uses the prepared package runtime in development', () => {
    const result = resolvePandocRuntimeOptions({
      appPath: '/application',
      isPackaged: false,
      resourcesPath: '/resources',
    })
    const binary = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'

    expect(result).toEqual({
      binaryPath: join(
        '/application/out/.pandoc-package-runtime',
        `${process.platform}-${process.arch}`,
        'runtime',
        binary,
      ),
      referencePath: join(
        '/application',
        'assets/document-export/reference.docx',
      ),
    })
  })

  it('uses architecture-specific packaged resources', () => {
    const result = resolvePandocRuntimeOptions({
      appPath: '/application',
      isPackaged: true,
      resourcesPath: '/resources',
    })
    const binary = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'

    expect(result).toEqual({
      binaryPath: join(
        '/resources/pandoc-runtime',
        `${process.platform}-${process.arch}`,
        'runtime',
        binary,
      ),
      referencePath: join('/resources/document-export/reference.docx'),
    })
  })
})
