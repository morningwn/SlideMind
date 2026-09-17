import { spawn } from 'node:child_process'
import { join } from 'node:path'

const platformIndex = process.argv.indexOf('--platform')
const target =
  platformIndex === -1 ? process.platform : process.argv[platformIndex + 1]
if (target !== process.platform) {
  console.log(
    `Packaged Agent execution remains unverified: run on a native ${target} host`,
  )
  process.exit(0)
}
if (!['darwin', 'win32'].includes(process.platform))
  throw new Error(`Unsupported package execution platform: ${process.platform}`)
const directory = join(
  'out',
  'release',
  process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? 'mac-arm64'
      : 'mac'
    : 'win-unpacked',
  ...(process.platform === 'darwin' ? ['SlideMind.app'] : []),
)
const child = spawn(
  process.execPath,
  ['scripts/agent-isolation/run.mjs', '--packaged', directory],
  { stdio: 'inherit' },
)
child.once('error', (error) => {
  throw error
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
