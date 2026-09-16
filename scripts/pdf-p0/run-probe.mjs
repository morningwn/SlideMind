import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, loadConfigFromFile } from 'vite'

const require = createRequire(import.meta.url)
const pdfkitPath = process.env.PDFKIT_PROBE_PATH
if (!pdfkitPath)
  throw new Error('Set PDFKIT_PROBE_PATH to a temporary PDFKit installation')
const output = resolve('.local/pdf-p0')
const profile = await mkdtemp(join(tmpdir(), 'slidemind-pdf-p0-'))
const config = await loadConfigFromFile(
  { command: 'serve', mode: 'test' },
  resolve('electron.vite.config.ts'),
)
const server = await createServer({
  ...config.config.renderer,
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 0 },
  clearScreen: false,
})

try {
  await mkdir(output, { recursive: true })
  await server.listen()
  const port = server.httpServer.address().port
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    require('electron'),
    [
      resolve('scripts/pdf-p0/probe-electron.cjs'),
      `http://127.0.0.1:${port}`,
      profile,
      output,
      resolve(pdfkitPath),
    ],
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
  await server.close()
  await rm(profile, { recursive: true, force: true })
}
