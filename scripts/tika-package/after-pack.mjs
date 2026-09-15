import { cp, lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const packageRuntimeRoot = join(repositoryRoot, 'out/.tika-package-runtime')
const archNames = new Map([
  [1, 'x64'],
  [3, 'arm64']
])

export default async function afterPack(context) {
  const arch = archNames.get(context.arch)
  const platform = context.packager.platform.nodeName
  if (!arch || !['darwin', 'win32'].includes(platform)) {
    throw new Error(`Unsupported Tika package target: ${platform}-${String(context.arch)}`)
  }

  const target = `${platform}-${arch}`
  const source = join(packageRuntimeRoot, target)
  await validateRuntime(source, target)

  const resourcesDirectory = context.packager.getResourcesDir(context.appOutDir)
  const destination = join(resourcesDirectory, 'tika-runtime', target)
  await rm(destination, { force: true, recursive: true })
  await mkdir(destination, { recursive: true })
  await cp(join(source, 'runtime'), join(destination, 'runtime'), {
    recursive: true,
    verbatimSymlinks: true
  })
  await cp(join(source, 'prepared-runtime.json'), join(destination, 'prepared-runtime.json'))
  await cp(join(source, 'tika-config.json'), join(destination, 'tika-config.json'))
  await validateRuntime(destination, target)
}

export async function validateRuntime(root, expectedPlatform) {
  const manifestPath = join(root, 'prepared-runtime.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== expectedPlatform ||
    manifest.tikaVersion !== '4.0.0' ||
    typeof manifest.javaBinary !== 'string' ||
    typeof manifest.tikaJar !== 'string' ||
    isAbsolute(manifest.javaBinary) ||
    isAbsolute(manifest.tikaJar)
  ) {
    throw new Error(`Invalid prepared Tika runtime manifest: ${manifestPath}`)
  }

  const requiredPaths = [
    manifest.javaBinary,
    manifest.tikaJar,
    'tika-config.json',
    'runtime/tika/LICENSE',
    'runtime/tika/NOTICE'
  ]
  for (const relativePath of requiredPaths) {
    const path = resolve(root, relativePath)
    if (!path.startsWith(`${resolve(root)}${sep}`)) {
      throw new Error(`Tika runtime path escapes its root: ${relativePath}`)
    }
    const stats = await lstat(path)
    if (!stats.isFile()) throw new Error(`Tika runtime resource is not a file: ${path}`)
  }

  const javaHome = dirname(dirname(resolve(root, manifest.javaBinary)))
  const notice = join(javaHome, 'NOTICE')
  const legal = join(javaHome, 'legal')
  if (!(await lstat(notice)).isFile() || !(await lstat(legal)).isDirectory()) {
    throw new Error(`Temurin legal resources are incomplete under ${javaHome}`)
  }

  return {
    configPath: join(root, 'tika-config.json'),
    javaBinary: resolve(root, manifest.javaBinary),
    tikaJar: resolve(root, manifest.tikaJar),
    tikaDirectory: dirname(resolve(root, manifest.tikaJar))
  }
}
