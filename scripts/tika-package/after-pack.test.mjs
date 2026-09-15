import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateRuntime } from './after-pack.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'slidemind-java-package-test-'))
  roots.push(root)
  await mkdir(join(root, 'runtime/java/bin'), { recursive: true })
  await mkdir(join(root, 'runtime/java/legal/java.base'), { recursive: true })
  await mkdir(join(root, 'runtime/tika'), { recursive: true })
  for (const path of [
    'runtime/java/bin/java',
    'runtime/java/NOTICE',
    'runtime/tika/server.jar',
    'runtime/tika/LICENSE',
    'runtime/tika/NOTICE',
    'tika-config.json',
  ]) {
    await writeFile(join(root, path), '')
  }
  await writeFile(join(root, 'runtime/java/release'), 'MODULES="java.base"\n')
  await writeFile(
    join(root, 'prepared-runtime.json'),
    JSON.stringify({
      schemaVersion: 1,
      platform: 'darwin-arm64',
      tikaVersion: '4.0.0',
      javaBinary: 'runtime/java/bin/java',
      tikaJar: 'runtime/tika/server.jar',
      javaOptimization: {
        mode: 'minimal',
        policyVersion: 1,
        modules: ['java.base'],
      },
    }),
  )
  return root
}

describe('linked Java packaging validation', () => {
  it('accepts a linked runtime with matching inventory and retained notices', async () => {
    const root = await fixture()
    expect((await validateRuntime(root, 'darwin-arm64')).javaBinary).toBe(
      join(root, 'runtime/java/bin/java'),
    )
  })

  it('rejects a runtime image from a different module selection', async () => {
    const root = await fixture()
    await writeFile(
      join(root, 'runtime/java/release'),
      'MODULES="java.base java.desktop"\n',
    )
    await expect(validateRuntime(root, 'darwin-arm64')).rejects.toThrow(
      'module inventory',
    )
  })

  it('rejects a linked runtime whose module licenses were removed', async () => {
    const root = await fixture()
    await rm(join(root, 'runtime/java/legal/java.base'), { recursive: true })
    await expect(validateRuntime(root, 'darwin-arm64')).rejects.toThrow()
  })

  it('continues to accept the full upstream runtime fallback', async () => {
    const root = await fixture()
    const path = join(root, 'prepared-runtime.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.javaOptimization = { mode: 'full' }
    await writeFile(path, JSON.stringify(manifest))
    await rm(join(root, 'runtime/java/release'))
    await expect(validateRuntime(root, 'darwin-arm64')).resolves.toBeDefined()
  })
})
