import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearArchivedLogFiles, rotateLogFile } from './logger'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ))
})

describe('rotateLogFile', () => {
  it('retains the configured number of archives in newest-first order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-logging-'))
    temporaryDirectories.push(directory)
    const currentPath = join(directory, 'slidemind.log')

    for (const value of ['one', 'two', 'three']) {
      await writeFile(currentPath, value)
      rotateLogFile(currentPath, 2)
    }

    await expect(readFile(join(directory, 'slidemind.1.log'), 'utf8')).resolves.toBe('three')
    await expect(readFile(join(directory, 'slidemind.2.log'), 'utf8')).resolves.toBe('two')
  })

  it('clears only archived SlideMind logs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-logging-'))
    temporaryDirectories.push(directory)
    const currentPath = join(directory, 'slidemind.log')
    const archivePath = join(directory, 'slidemind.1.log')
    const unrelatedPath = join(directory, 'unrelated.log')
    await Promise.all([
      writeFile(currentPath, 'current'),
      writeFile(archivePath, 'archive'),
      writeFile(unrelatedPath, 'unrelated')
    ])

    clearArchivedLogFiles(directory)

    await expect(readFile(currentPath, 'utf8')).resolves.toBe('current')
    await expect(readFile(unrelatedPath, 'utf8')).resolves.toBe('unrelated')
    await expect(readFile(archivePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
