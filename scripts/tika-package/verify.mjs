import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { validateRuntime } from './after-pack.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const releaseRoot = resolve(
  readOption('--release-root') ?? join(repositoryRoot, 'out/release'),
)
const expectedPlatforms = (
  readOption('--platforms') ?? `${process.platform}-${process.arch}`
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const manifests = await findFiles(releaseRoot, 'prepared-runtime.json')

for (const platform of expectedPlatforms) {
  const manifest = manifests.find((path) =>
    path.includes(`${join('tika-runtime', platform, 'prepared-runtime.json')}`),
  )
  if (!manifest)
    throw new Error(`Packaged Tika runtime was not found for ${platform}`)
  const runtime = await validateRuntime(dirname(manifest), platform)
  if (platform === `${process.platform}-${process.arch}`) {
    await run(runtime.javaBinary, ['-version'])
    await run(runtime.javaBinary, ['-jar', runtime.tikaJar, '--help'], {
      cwd: runtime.tikaDirectory,
    })
    await verifyDocumentExtraction(runtime)
  }
  console.log(`Verified packaged Tika runtime: ${platform}`)
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function findFiles(root, name) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await findFiles(path, name)))
    else if (entry.isFile() && entry.name === name) result.push(path)
  }
  return result
}

async function run(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}

async function verifyDocumentExtraction(runtime) {
  const port = await reservePort()
  const workDirectory = await mkdtemp(join(tmpdir(), 'slidemind-tika-package-'))
  const child = spawn(
    runtime.javaBinary,
    [
      '-Xmx256m',
      `-Djava.io.tmpdir=${workDirectory}`,
      '-jar',
      runtime.tikaJar,
      '-c',
      runtime.configPath,
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-i',
      `slidemind-package-${randomUUID()}`,
    ],
    {
      cwd: runtime.tikaDirectory,
      detached: process.platform !== 'win32',
      env: minimalEnvironment(runtime.javaBinary, workDirectory),
      stdio: 'ignore',
      windowsHide: true,
    },
  )

  try {
    await waitForServer(port, child)
    const fixtureRoot = join(repositoryRoot, 'scripts/tika-p0/fixtures')
    const expectations = JSON.parse(
      await readFile(join(fixtureRoot, 'expectations.json'), 'utf8'),
    )
    for (const sample of expectations.samples) {
      const fixture = await readFile(join(fixtureRoot, sample.file))
      const response = await fetch(`http://127.0.0.1:${port}/rmeta/text`, {
        body: fixture,
        headers: {
          'Content-Disposition': `attachment; filename="${sample.file}"`,
        },
        method: 'PUT',
        redirect: 'error',
        signal: AbortSignal.timeout(90_000),
      })
      if (!response.ok)
        throw new Error(
          `Packaged Tika extraction failed for ${sample.file}: ${response.status}`,
        )
      const entries = await response.json()
      const content = Array.isArray(entries)
        ? entries.map((entry) => entry?.['tk:content'] ?? '').join('\n')
        : ''
      for (const expected of sample.requiredText) {
        if (!content.includes(expected))
          throw new Error(
            `Packaged Tika extraction missed ${sample.file}: ${expected}`,
          )
      }
    }
  } finally {
    await terminateTree(child)
    await rm(workDirectory, { force: true, recursive: true })
  }
}

async function reservePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a Tika loopback port'))
        return
      }
      server.close((error) =>
        error ? reject(error) : resolvePromise(address.port),
      )
    })
  })
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Packaged Tika exited with ${child.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/version`, {
        signal: AbortSignal.timeout(500),
      })
      if (response.ok && (await response.text()).includes('4.0.0')) return
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Packaged Tika startup exceeded 30 seconds')
}

function minimalEnvironment(javaBinary, workDirectory) {
  const environment = {
    JAVA_HOME: dirname(dirname(javaBinary)),
    NO_PROXY: '127.0.0.1,localhost',
    PATH: dirname(javaBinary),
    TEMP: workDirectory,
    TMP: workDirectory,
    TMPDIR: workDirectory,
    no_proxy: '127.0.0.1,localhost',
  }
  for (const key of ['LANG', 'LC_ALL', 'SystemRoot', 'WINDIR']) {
    if (process.env[key]) environment[key] = process.env[key]
  }
  return environment
}

async function terminateTree(child) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise((resolvePromise) => {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        {
          stdio: 'ignore',
          windowsHide: true,
        },
      )
      killer.once('error', resolvePromise)
      killer.once('exit', resolvePromise)
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ])
  if (child.exitCode === null)
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
}
