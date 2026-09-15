import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { javaMode } from '../tika-p0/java-runtime.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const packageRuntimeRoot = join(repositoryRoot, 'out/.tika-package-runtime')
const hostPlatform = `${process.platform}-${process.arch}`
const requested = readOption('--platforms') ?? hostPlatform
const mode = javaMode(
  readOption('--java-mode') ?? process.env.SLIDEMIND_JAVA_MODE,
)
const platforms = requested
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const supported = new Set(['darwin-arm64', 'darwin-x64', 'win32-x64'])

if (
  platforms.length === 0 ||
  platforms.some((platform) => !supported.has(platform))
) {
  throw new Error(`Unsupported package platform list: ${requested}`)
}

for (const platform of platforms) {
  const args = [
    join(repositoryRoot, 'scripts/tika-p0/prepare-runtime.mjs'),
    '--platform',
    platform,
    '--java-mode',
    mode,
    '--output',
    join(packageRuntimeRoot, platform),
  ]
  if (platform !== hostPlatform) args.push('--skip-execution')
  await run(process.execPath, args)
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}
