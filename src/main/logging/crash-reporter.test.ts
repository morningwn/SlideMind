import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  initializeLocalCrashReporting,
  inspectLocalCrashReports,
} from './crash-reporter'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  )
})

describe('inspectLocalCrashReports', () => {
  it('finds nested minidumps without following symbolic links', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-crashes-'))
    temporaryDirectories.push(directory)
    const pendingDirectory = join(directory, 'pending')
    const externalDirectory = await mkdtemp(
      join(tmpdir(), 'slidemind-external-crashes-'),
    )
    temporaryDirectories.push(externalDirectory)
    await mkdir(pendingDirectory)
    const oldDump = join(directory, 'old.dmp')
    const latestDump = join(pendingDirectory, 'latest.DMP')
    await Promise.all([
      writeFile(oldDump, 'old'),
      writeFile(latestDump, 'latest'),
      writeFile(join(directory, 'settings.dat'), 'ignore'),
      writeFile(join(externalDirectory, 'external.dmp'), 'ignore'),
    ])
    await symlink(externalDirectory, join(directory, 'linked'))
    await utimes(
      oldDump,
      new Date('2026-08-30T10:00:00.000Z'),
      new Date('2026-08-30T10:00:00.000Z'),
    )
    await utimes(
      latestDump,
      new Date('2026-08-31T10:00:00.000Z'),
      new Date('2026-08-31T10:00:00.000Z'),
    )

    await expect(inspectLocalCrashReports(directory)).resolves.toEqual({
      count: 2,
      latestModifiedAt: '2026-08-31T10:00:00.000Z',
      truncated: false,
    })
  })

  it('treats a missing crash directory as empty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slidemind-crashes-'))
    temporaryDirectories.push(directory)
    await expect(
      inspectLocalCrashReports(join(directory, 'missing')),
    ).resolves.toEqual({
      count: 0,
      truncated: false,
    })
  })

  it('starts crash reporting in local-only mode', () => {
    let uploadToServer = true
    let startOptions: Electron.CrashReporterStartOptions | undefined
    initializeLocalCrashReporting('SlideMind', {
      start: (options) => {
        startOptions = options
      },
      getUploadToServer: () => uploadToServer,
      setUploadToServer: (value) => {
        uploadToServer = value
      },
    })

    expect(startOptions).toEqual({
      productName: 'SlideMind',
      uploadToServer: false,
    })
    expect(uploadToServer).toBe(false)
  })
})
