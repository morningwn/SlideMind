import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import {
  imageModules,
  javaMode,
  jlinkArguments,
  jlinkModules,
} from './java-runtime.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const manifest = JSON.parse(
  await readFile(join(scriptDirectory, 'runtime-manifest.json'), 'utf8'),
)
const platform =
  readOption('--platform') ?? `${process.platform}-${process.arch}`
const hostPlatform = `${process.platform}-${process.arch}`
const outputRoot = resolve(
  readOption('--output') ??
    join(repositoryRoot, 'out/.tika-p0-runtime', platform),
)
const skipExecution = process.argv.includes('--skip-execution')
const mode = javaMode(
  readOption('--java-mode') ?? process.env.SLIDEMIND_JAVA_MODE,
)
const downloadedArtifacts = new Map()
const jdkHomes = new Map()
const downloadsRoot = join(outputRoot, 'downloads')
const runtimeRoot = join(outputRoot, 'runtime')
const javaArtifact = manifest.java.artifacts[platform]

if (!javaArtifact) {
  throw new Error(`Unsupported P0 platform: ${platform}`)
}
if (platform !== hostPlatform && !skipExecution) {
  throw new Error(
    `P0 preparation executes the runtime and must run on its target platform: requested ${platform}, host ${hostPlatform}`,
  )
}

await mkdir(downloadsRoot, { recursive: true })
await rm(join(outputRoot, 'prepared-runtime.json'), { force: true })
await rm(runtimeRoot, { recursive: true, force: true })
await mkdir(runtimeRoot, { recursive: true })

const tikaArchive = await downloadVerified(manifest.tika, 'sha512')
const javaArchive = await downloadVerified(javaArtifact, 'sha256')
const tikaPgpVerified = await verifyTikaSignature(tikaArchive)
const tikaRoot = join(runtimeRoot, 'tika')
const javaRoot = join(runtimeRoot, 'java')
await mkdir(tikaRoot, { recursive: true })
await mkdir(javaRoot, { recursive: true })
await extract(tikaArchive, tikaRoot)
await extract(javaArchive, javaRoot)

const tikaJar = await findFile(
  tikaRoot,
  `tika-server-standard-${manifest.tika.version}.jar`,
)
const javaBinaryName = platform.startsWith('win32-') ? 'java.exe' : 'java'
let javaBinary = await findFile(javaRoot, javaBinaryName, (path) =>
  path.includes(`${join('bin', javaBinaryName)}`),
)
const originalJavaHome = dirname(dirname(javaBinary))
const sourceBytes = await directorySize(javaRoot)
let javaOptimization = {
  mode,
  sourceBytes,
  runtimeBytes: sourceBytes,
  removedBytes: 0,
}
if (mode !== 'full') {
  javaOptimization = await linkJavaRuntime(originalJavaHome, sourceBytes)
  javaBinary = join(javaRoot, 'bin', javaBinaryName)
}
if (!skipExecution) {
  await run(javaBinary, ['-version'])
  await run(javaBinary, ['-jar', tikaJar, '--help'], { cwd: dirname(tikaJar) })
}

await copyFile(
  join(scriptDirectory, 'tika-config.json'),
  join(outputRoot, 'tika-config.json'),
)

const prepared = {
  schemaVersion: 1,
  platform,
  tikaVersion: manifest.tika.version,
  javaVersion: manifest.java.version,
  tikaJar: portablePath(tikaJar),
  javaBinary: portablePath(javaBinary),
  javaOptimization,
  downloadedBytes: [...downloadedArtifacts.values()].reduce(
    (total, size) => total + size,
    0,
  ),
  runtimeBytes: await directorySize(runtimeRoot),
  tikaPgpVerified,
  executionVerified: !skipExecution,
  preparedAt: new Date().toISOString(),
}
await writeFile(
  join(outputRoot, 'prepared-runtime.json'),
  `${JSON.stringify(prepared, null, 2)}\n`,
)
console.log(JSON.stringify(prepared, null, 2))

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function portablePath(path) {
  return path
    .slice(outputRoot.length + 1)
    .split('\\')
    .join('/')
}

async function prepareJdk(target) {
  if (jdkHomes.has(target)) return jdkHomes.get(target)
  const artifact = manifest.java.jdkArtifacts[target]
  if (!artifact)
    throw new Error(
      `No pinned JDK is available for build host/target: ${target}`,
    )
  const archive = await downloadVerified(artifact, 'sha256')
  // Build tools stay outside runtime/ and are never copied into the application.
  const root = join(outputRoot, 'build-tools', target)
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  await extract(archive, root)
  const executable = target.startsWith('win32-') ? 'jlink.exe' : 'jlink'
  const home = dirname(dirname(await findFile(root, executable)))
  jdkHomes.set(target, home)
  return home
}

async function linkJavaRuntime(originalJavaHome, sourceBytes) {
  const hostJdk = await prepareJdk(hostPlatform)
  const targetJdk = await prepareJdk(platform)
  const tool = (name) =>
    join(hostJdk, 'bin', process.platform === 'win32' ? `${name}.exe` : name)
  const listModules = async (home) =>
    imageModules(
      await runCapture(tool('jimage'), ['list', join(home, 'lib/modules')]),
    )
  // Inspect the actual module image; upstream JRE release metadata can list JDK-only modules.
  const originalModules = await listModules(originalJavaHome)
  const rootModules = jlinkModules(mode, platform, originalModules)
  const linkedRoot = `${javaRoot}.linked`
  await rm(linkedRoot, { recursive: true, force: true })
  await run(
    tool('jlink'),
    jlinkArguments(join(targetJdk, 'jmods'), rootModules, linkedRoot),
  )
  const modules = await listModules(linkedRoot)
  for (const module of modules) {
    if (!originalModules.includes(module))
      throw new Error(`jlink unexpectedly added module: ${module}`)
  }
  for (const module of rootModules) {
    if (!modules.includes(module))
      throw new Error(`jlink omitted required module: ${module}`)
  }
  await copyFile(join(originalJavaHome, 'NOTICE'), join(linkedRoot, 'NOTICE'))
  await rm(join(linkedRoot, 'legal'), { recursive: true, force: true })
  await cp(join(originalJavaHome, 'legal'), join(linkedRoot, 'legal'), {
    recursive: true,
    verbatimSymlinks: true,
  })
  await rm(javaRoot, { recursive: true, force: true })
  await rename(linkedRoot, javaRoot)
  const runtimeBytes = await directorySize(javaRoot)
  return {
    mode,
    policyVersion: 1,
    compression: 'zip-6',
    stripDebug: true,
    sourceBytes,
    runtimeBytes,
    removedBytes: sourceBytes - runtimeBytes,
    originalModules,
    rootModules,
    modules,
  }
}

async function downloadVerified(artifact, algorithm) {
  downloadedArtifacts.set(artifact.archive, artifact.size)
  const destination = join(downloadsRoot, artifact.archive)
  let shouldDownload = true
  try {
    const existing = await stat(destination)
    shouldDownload =
      existing.size !== artifact.size ||
      (await digest(destination, algorithm)) !== artifact[algorithm]
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (shouldDownload) {
    const partial = `${destination}.partial`
    await rm(partial, { force: true })
    const response = await fetch(artifact.url)
    if (!response.ok || !response.body)
      throw new Error(`Download failed (${response.status}): ${artifact.url}`)
    const finalHost = new URL(response.url).hostname
    const allowedHosts = new Set([
      'downloads.apache.org',
      'github.com',
      'release-assets.githubusercontent.com',
    ])
    if (!allowedHosts.has(finalHost))
      throw new Error(`Download redirected to untrusted host: ${finalHost}`)
    await pipeline(response.body, createWriteStream(partial, { mode: 0o600 }))
    const downloaded = await stat(partial)
    if (downloaded.size !== artifact.size)
      throw new Error(
        `Unexpected size for ${artifact.archive}: ${downloaded.size}`,
      )
    const actual = await digest(partial, algorithm)
    if (actual !== artifact[algorithm])
      throw new Error(`Checksum mismatch for ${artifact.archive}: ${actual}`)
    await rename(partial, destination)
  }
  return destination
}

async function verifyTikaSignature(archive) {
  if (!(await commandExists('gpg'))) {
    console.warn(
      'gpg is unavailable; relying on the pinned SHA-512 obtained from the Apache HTTPS release page',
    )
    return false
  }
  const signature = join(downloadsRoot, `${manifest.tika.archive}.asc`)
  const keys = join(downloadsRoot, 'apache-tika-KEYS')
  await downloadHttps(manifest.tika.signatureUrl, signature)
  await downloadHttps(manifest.tika.keysUrl, keys)
  // Git for Windows ships an MSYS gpg that rewrites path arguments before the
  // process sees them, and gpg sockets fail on long keyring paths. Keep the
  // keyring short through GNUPGHOME and pass only relative paths, so native and
  // MSYS builds resolve the same files.
  const gpgHome = await mkdtemp(join(tmpdir(), 'slidemind-tika-gpg-'))
  const gpgOptions = {
    cwd: downloadsRoot,
    env: {
      ...process.env,
      GNUPGHOME: gpgHome,
      MSYS2_ARG_CONV_EXCL: '*',
      MSYS_NO_PATHCONV: '1',
    },
  }
  try {
    await run('gpg', ['--batch', '--import', basename(keys)], gpgOptions)
    const output = await runCapture(
      'gpg',
      [
        '--batch',
        '--status-fd=1',
        '--verify',
        basename(signature),
        basename(archive),
      ],
      gpgOptions,
    )
    const validSignatures = output
      .split('\n')
      .filter((line) => line.startsWith('[GNUPG:] VALIDSIG '))
      .map((line) => line.split(/\s+/)[2])
    if (!validSignatures.includes(manifest.tika.signerFingerprint)) {
      throw new Error(
        `Apache Tika signature did not match pinned signer ${manifest.tika.signerFingerprint}`,
      )
    }
    return true
  } finally {
    await rm(gpgHome, { recursive: true, force: true })
  }
}

async function downloadHttps(url, destination) {
  const response = await fetch(url)
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}): ${url}`)
  if (new URL(response.url).protocol !== 'https:')
    throw new Error(`Refusing non-HTTPS response: ${response.url}`)
  await pipeline(response.body, createWriteStream(destination, { mode: 0o600 }))
}

async function digest(path, algorithm) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function extract(archive, destination) {
  await run('tar', ['-xf', archive, '-C', destination])
}

async function findFile(root, name, predicate = () => true) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFile(path, name, predicate).catch(() => null)
      if (nested) return nested
    } else if (entry.name === name && predicate(path)) {
      await access(path)
      return path
    }
  }
  throw new Error(`Could not find ${name} under ${root}`)
}

async function directorySize(root) {
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    total += entry.isDirectory()
      ? await directorySize(path)
      : (await stat(path)).size
  }
  return total
}

async function run(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(`${[command, ...args].join(' ')} exited with ${code}`),
          ),
    )
  })
}

async function runCapture(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (value) => {
      stdout += value
    })
    child.stderr.on('data', (value) => {
      stderr += value
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise(stdout)
        : reject(new Error(`${command} exited with ${code}: ${stderr}`)),
    )
  })
}

async function commandExists(command) {
  try {
    await runCapture(process.platform === 'win32' ? 'where' : 'which', [
      command,
    ])
    return true
  } catch {
    return false
  }
}
