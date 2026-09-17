import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const packageRuntimeRoot = join(repositoryRoot, 'out/.pandoc-package-runtime')
const runtimeManifest = JSON.parse(
  await readFile(
    join(repositoryRoot, 'scripts/pandoc-p0/runtime-manifest.json'),
    'utf8',
  ),
)
const expectedSource = runtimeManifest.correspondingSource
const archNames = new Map([
  [1, 'x64'],
  [3, 'arm64'],
])

export default async function afterPack(context) {
  const arch = archNames.get(context.arch)
  const platform = context.packager.platform.nodeName
  if (!arch || !['darwin', 'win32'].includes(platform)) {
    throw new Error(
      `Unsupported Pandoc package target: ${platform}-${String(context.arch)}`,
    )
  }

  const target = `${platform}-${arch}`
  const source = join(packageRuntimeRoot, target)
  await validateRuntime(source, target)

  const resourcesDirectory = context.packager.getResourcesDir(context.appOutDir)
  const destination = join(resourcesDirectory, 'pandoc-runtime', target)
  await rm(destination, { force: true, recursive: true })
  await mkdir(destination, { recursive: true })
  await cp(join(source, 'runtime'), join(destination, 'runtime'), {
    recursive: true,
    verbatimSymlinks: true,
  })
  await cp(
    join(source, 'prepared-runtime.json'),
    join(destination, 'prepared-runtime.json'),
  )

  const documentExportDirectory = join(resourcesDirectory, 'document-export')
  await mkdir(documentExportDirectory, { recursive: true })
  await cp(
    join(repositoryRoot, 'assets/document-export/reference.docx'),
    join(documentExportDirectory, 'reference.docx'),
  )
  await validateRuntime(destination, target)
  await validateReferenceDocument(
    join(documentExportDirectory, 'reference.docx'),
  )
}

export async function validateRuntime(
  root,
  expectedPlatform,
  sourceIntegrity = {
    size: expectedSource.size,
    sha256: expectedSource.sha256,
  },
) {
  const manifestPath = join(root, 'prepared-runtime.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== expectedPlatform ||
    manifest.pandocVersion !== runtimeManifest.pandocVersion ||
    typeof manifest.binary !== 'string' ||
    isAbsolute(manifest.binary)
  ) {
    throw new Error(`Invalid prepared Pandoc runtime manifest: ${manifestPath}`)
  }

  const expectedDescription = new Map([
    ['darwin-arm64', 'Mach-O 64-bit executable arm64'],
    ['darwin-x64', 'Mach-O 64-bit executable x86_64'],
    ['win32-x64', 'PE32+ executable x86-64, for MS Windows'],
  ]).get(expectedPlatform)
  if (manifest.fileDescription !== expectedDescription) {
    throw new Error(`Unexpected Pandoc architecture metadata: ${manifestPath}`)
  }

  if (
    manifest.correspondingSource?.path !==
      `runtime/${expectedSource.archive}` ||
    manifest.correspondingSource?.url !== expectedSource.url ||
    manifest.correspondingSource?.bytes !== expectedSource.size ||
    manifest.correspondingSource?.sha256 !== expectedSource.sha256
  ) {
    throw new Error(
      `Pandoc corresponding source is missing from ${manifestPath}`,
    )
  }

  for (const relativePath of [
    manifest.binary,
    manifest.correspondingSource.path,
    'runtime/COPYING.md',
    'runtime/COPYRIGHT',
  ]) {
    const path = resolve(root, relativePath)
    if (!path.startsWith(`${resolve(root)}${sep}`)) {
      throw new Error(`Pandoc runtime path escapes its root: ${relativePath}`)
    }
    const stats = await lstat(path)
    if (!stats.isFile())
      throw new Error(`Pandoc runtime resource is not a file: ${path}`)
  }

  const sourcePath = resolve(root, manifest.correspondingSource.path)
  const sourceStats = await lstat(sourcePath)
  if (
    sourceStats.size !== sourceIntegrity.size ||
    (await digest(sourcePath)) !== sourceIntegrity.sha256
  ) {
    throw new Error(
      `Pandoc corresponding source archive failed verification: ${sourcePath}`,
    )
  }

  const binaryPath = resolve(root, manifest.binary)
  const description = await describeBinary(binaryPath)
  if (description !== expectedDescription) {
    throw new Error(`Unexpected Pandoc binary architecture: ${description}`)
  }
  return { binaryPath, manifest }
}

async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function validateReferenceDocument(path) {
  const stats = await lstat(path)
  if (!stats.isFile() || stats.size < 4) {
    throw new Error(`Invalid Word reference document: ${path}`)
  }
  const file = await open(path, 'r')
  const signature = Buffer.alloc(4)
  try {
    await file.read(signature, 0, signature.length, 0)
  } finally {
    await file.close()
  }
  if (!signature.equals(Buffer.from('PK\u0003\u0004'))) {
    throw new Error(`Word reference document is not a DOCX archive: ${path}`)
  }
}

async function describeBinary(path) {
  const file = await open(path, 'r')
  const buffer = Buffer.alloc(4096)
  try {
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead < 64)
      throw new Error(`Pandoc binary header is too short: ${path}`)
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
