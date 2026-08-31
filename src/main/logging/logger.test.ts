import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rotateLogFile } from './logger'

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
})
