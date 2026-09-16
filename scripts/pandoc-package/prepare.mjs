import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const packageRuntimeRoot = join(repositoryRoot, 'out/.pandoc-package-runtime')
const runtimeManifest = JSON.parse(
  await readFile(join(repositoryRoot, 'scripts/pandoc-p0/runtime-manifest.json'), 'utf8'),
)
const hostPlatform = `${process.platform}-${process.arch}`
const requested = readOption('--platforms') ?? hostPlatform
const platforms = requested
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const supported = new Set(['darwin-arm64', 'darwin-x64', 'win32-x64'])
const sourceArtifact = runtimeManifest.correspondingSource

if (
  platforms.length === 0 ||
  platforms.some((platform) => !supported.has(platform))
) {
  throw new Error(`Unsupported Pandoc package platform list: ${requested}`)
}

const sourcePath = await prepareSourceArchive()

for (const platform of platforms) {
  const args = [
    join(repositoryRoot, 'scripts/pandoc-p0/prepare-runtime.mjs'),
    '--platform',
    platform,
    '--output',
    join(packageRuntimeRoot, platform),
  ]
  if (platform !== hostPlatform) args.push('--skip-execution')
  await run(process.execPath, args)
  const platformRoot = join(packageRuntimeRoot, platform)
  await copyFile(sourcePath, join(platformRoot, 'runtime', sourceArtifact.archive))
  const manifestPath = join(platformRoot, 'prepared-runtime.json')
  const prepared = JSON.parse(await readFile(manifestPath, 'utf8'))
  prepared.correspondingSource = {
    path: `runtime/${sourceArtifact.archive}`,
    url: sourceArtifact.url,
    bytes: sourceArtifact.size,
    sha256: sourceArtifact.sha256,
  }
  prepared.runtimeBytes += sourceArtifact.size
  await writeFile(manifestPath, `${JSON.stringify(prepared, null, 2)}\n`)
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}

async function prepareSourceArchive() {
  const directory = join(packageRuntimeRoot, '.source')
  const destination = join(directory, sourceArtifact.archive)
  await mkdir(directory, { recursive: true })
  if (await isVerified(destination)) return destination

  const partial = `${destination}.partial`
  await rm(partial, { force: true })
  const response = await fetch(sourceArtifact.url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Pandoc source download failed (${response.status})`)
  }
  const finalHost = new URL(response.url).hostname
  if (!['github.com', 'codeload.github.com'].includes(finalHost)) {
    throw new Error(`Pandoc source redirected to untrusted host: ${finalHost}`)
  }
  await pipeline(response.body, createWriteStream(partial, { mode: 0o600 }))
  if (!(await isVerified(partial))) {
    await rm(partial, { force: true })
    throw new Error('Pandoc source archive failed checksum verification')
  }
  await rename(partial, destination)
  return destination
}

async function isVerified(path) {
  try {
    const stats = await stat(path)
    if (stats.size !== sourceArtifact.size) return false
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex') === sourceArtifact.sha256
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
