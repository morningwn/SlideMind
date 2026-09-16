import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const packaged = process.argv[2] === '--asar'
const appPath = packaged
  ? resolve(
      process.argv[3] ??
        'out/release/mac-arm64/SlideMind.app/Contents/Resources/app.asar',
    )
  : resolve('.')
const output = resolve('.local/pdf-p3', packaged ? 'asar' : 'build')
const profile = await mkdtemp(join(tmpdir(), 'slidemind-pdf-p3-'))

try {
  await stat(packaged ? appPath : resolve('out/main/index.js'))
  if (!packaged) await stat(resolve('out/renderer/markdown-pdf.html'))
  await mkdir(output, { recursive: true })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const child = spawn(
    require('electron'),
    [resolve('scripts/pdf-p3/probe-electron.cjs'), profile, output, appPath],
    { stdio: 'inherit', env },
  )
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 240_000)
  try {
    process.exitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolveExit(code ?? 1))
    })
  } finally {
    clearTimeout(watchdog)
  }
} finally {
  await rm(profile, { recursive: true, force: true })
}
