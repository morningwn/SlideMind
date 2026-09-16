import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { validateReferenceDocument, validateRuntime } from './after-pack.mjs'

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
  const marker = join('pandoc-runtime', platform, 'prepared-runtime.json')
  const manifestPath = manifests.find((path) => path.includes(marker))
  if (!manifestPath)
    throw new Error(`Packaged Pandoc runtime was not found for ${platform}`)

  const root = dirname(manifestPath)
  const runtime = await validateRuntime(root, platform)
  const resourcesDirectory = resolve(root, '../..')
  const referencePath = join(
    resourcesDirectory,
    'document-export/reference.docx',
  )
  await validateReferenceDocument(referencePath)
  if (platform === `${process.platform}-${process.arch}`) {
    await verifyConversion(runtime.binaryPath, referencePath)
  }
  console.log(`Verified packaged Pandoc runtime: ${platform}`)
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

async function verifyConversion(binaryPath, referencePath) {
  const directory = await mkdtemp(join(tmpdir(), 'slidemind-pandoc-package-'))
  const outputPath = join(directory, 'probe.docx')
  try {
    const version = await run(binaryPath, ['--version'])
    if (!version.startsWith('pandoc 3.11')) {
      throw new Error(
        `Unexpected packaged Pandoc version: ${version.split('\n')[0]}`,
      )
    }
    await run(
      binaryPath,
      [
        '--sandbox',
        '--from=gfm',
        '--to=docx',
        `--reference-doc=${referencePath}`,
        '--output',
        outputPath,
        '+RTS',
        '-M512m',
        '-RTS',
      ],
      '# 打包验证\n\n| A | B |\n| - | - |\n| 1 | 2 |\n',
    )
    const bytes = await readFile(outputPath)
    if (
      (await stat(outputPath)).size === 0 ||
      bytes.subarray(0, 2).toString() !== 'PK'
    ) {
      throw new Error('Packaged Pandoc did not create a valid DOCX archive')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function run(command, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
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
    child.once('exit', (code) => {
      if (code === 0) resolvePromise(stdout)
      else
        reject(
          new Error(`${command} exited with ${code}: ${stderr.slice(-2000)}`),
        )
    })
    child.stdin.end(input)
  })
}
