import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const manifest = JSON.parse(
  await readFile(join(scriptDirectory, 'runtime-manifest.json'), 'utf8'),
)
const platform =
  readOption('--platform') ?? `${process.platform}-${process.arch}`
const hostPlatform = `${process.platform}-${process.arch}`
const skipExecution = process.argv.includes('--skip-execution')
const outputRoot = resolve(
  readOption('--output') ??
    join(repositoryRoot, 'out/.pandoc-p0-runtime', platform),
)
const artifact = manifest.artifacts[platform]

if (!artifact) throw new Error(`Unsupported P0 platform: ${platform}`)
if (platform !== hostPlatform && !skipExecution) {
  throw new Error(
    `P0 preparation executes the runtime and must run on its target platform: requested ${platform}, host ${hostPlatform}`,
  )
}

const downloadsRoot = join(outputRoot, 'downloads')
const extractionRoot = join(outputRoot, 'extracted')
const runtimeRoot = join(outputRoot, 'runtime')
await mkdir(downloadsRoot, { recursive: true })
await rm(extractionRoot, { recursive: true, force: true })
await rm(runtimeRoot, { recursive: true, force: true })
await rm(join(outputRoot, 'prepared-runtime.json'), { force: true })
await mkdir(extractionRoot, { recursive: true })
await mkdir(runtimeRoot, { recursive: true })

const archive = await downloadVerified(artifact)
await extractZipSafely(archive, extractionRoot)
const sourceBinary = await findFile(extractionRoot, artifact.binary)
const binary = join(runtimeRoot, artifact.binary)
await copyFile(sourceBinary, binary)
if (platform !== 'win32-x64') await chmod(binary, 0o755)

for (const license of manifest.licenses) {
  await copyFile(
    await downloadVerified(license),
    join(runtimeRoot, license.archive),
  )
}

const fileDescription = await describeBinary(binary)
if (fileDescription !== artifact.fileDescription) {
  throw new Error(
    `Unexpected binary architecture for ${platform}: ${fileDescription.trim()}`,
  )
}

let versionOutput = null
let embeddedReferenceDoc = null
if (!skipExecution) {
  versionOutput = await runCapture(binary, ['--version'])
  if (!versionOutput.startsWith(`pandoc ${manifest.pandocVersion}`)) {
    throw new Error(
      `Unexpected Pandoc version: ${versionOutput.split('\n')[0]}`,
    )
  }
  embeddedReferenceDoc = join(outputRoot, 'default-reference.docx')
  await run(binary, [
    '--output',
    embeddedReferenceDoc,
    '--print-default-data-file=reference.docx',
  ])
}

const prepared = {
  schemaVersion: 1,
  platform,
  pandocVersion: manifest.pandocVersion,
  archive: artifact.archive,
  archiveBytes: artifact.size,
  archiveSha256: artifact.sha256,
  binary: portablePath(binary),
  binaryBytes: (await stat(binary)).size,
  runtimeBytes: await directorySize(runtimeRoot),
  fileDescription,
  embeddedReferenceDoc: embeddedReferenceDoc
    ? portablePath(embeddedReferenceDoc)
    : null,
  executionVerified: !skipExecution,
  versionOutput: versionOutput?.split('\n')[0] ?? null,
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

async function downloadVerified(value) {
  const destination = join(downloadsRoot, value.archive)
  let valid = false
  try {
    const existing = await stat(destination)
    valid =
      existing.size === value.size &&
      (await digest(destination, 'sha256')) === value.sha256
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (valid) return destination

  const partial = `${destination}.partial`
  await rm(partial, { force: true })
  const response = await fetch(value.url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${value.url}`)
  }
  const allowedHosts = new Set([
    'github.com',
    'objects.githubusercontent.com',
    'raw.githubusercontent.com',
    'release-assets.githubusercontent.com',
  ])
  const finalHost = new URL(response.url).hostname
  if (!allowedHosts.has(finalHost)) {
    throw new Error(`Download redirected to untrusted host: ${finalHost}`)
  }
  await pipeline(response.body, createWriteStream(partial, { mode: 0o600 }))
  const downloaded = await stat(partial)
  if (downloaded.size !== value.size) {
    throw new Error(
      `Unexpected size for ${value.archive}: ${downloaded.size} bytes`,
    )
  }
  const actual = await digest(partial, 'sha256')
  if (actual !== value.sha256) {
    throw new Error(`Checksum mismatch for ${value.archive}: ${actual}`)
  }
  await rename(partial, destination)
  return destination
}

async function extractZipSafely(archive, destination) {
  const entries = (await runCapture('tar', ['-tf', archive]))
    .split(/\r?\n/)
    .filter(Boolean)
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/')
    if (
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`Archive contains an unsafe path: ${entry}`)
    }
  }
  await run('tar', ['-xf', archive, '-C', destination])
}

async function describeBinary(path) {
  const file = await open(path, 'r')
  const buffer = Buffer.alloc(4096)
  try {
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead < 64) throw new Error(`Binary header is too short: ${path}`)
  } finally {
    await file.close()
  }

  if (buffer.readUInt32LE(0) === 0xfeedfacf) {
    const cpuType = buffer.readUInt32LE(4)
    if (cpuType === 0x0100000c) return 'Mach-O 64-bit executable arm64'
    if (cpuType === 0x01000007) return 'Mach-O 64-bit executable x86_64'
  }
  if (buffer.subarray(0, 2).toString('ascii') === 'MZ') {
    const peOffset = buffer.readUInt32LE(0x3c)
    if (
      peOffset + 6 <= buffer.length &&
      buffer.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0')) &&
      buffer.readUInt16LE(peOffset + 4) === 0x8664
    ) {
      return 'PE32+ executable x86-64, for MS Windows'
    }
  }
  return 'unknown'
}

async function findFile(root, name) {
  const result = await findOptionalFile(root, [name])
  if (!result) throw new Error(`Missing ${name} in extracted Pandoc archive`)
  return result
}

async function findOptionalFile(root, names) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = await findOptionalFile(path, names)
      if (nested) return nested
    } else if (entry.isFile() && names.includes(entry.name)) {
      return path
    }
  }
  return null
}

async function directorySize(root) {
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    total += entry.isDirectory()
      ? await directorySize(path)
      : entry.isFile()
        ? (await stat(path)).size
        : 0
  }
  return total
}

async function digest(path, algorithm) {
  const hash = createHash(algorithm)
  const file = await import('node:fs').then(({ createReadStream }) =>
    createReadStream(path),
  )
  for await (const chunk of file) hash.update(chunk)
  return hash.digest('hex')
}

async function run(command, args) {
  await runCapture(command, args)
}

async function runCapture(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
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
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(stdout)
      else
        reject(
          new Error(
            `${command} exited with ${signal ?? code}: ${stderr.slice(-4000)}`,
          ),
        )
    })
  })
}
