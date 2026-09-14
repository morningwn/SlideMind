import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, loadConfigFromFile } from 'vite'

const require = createRequire(import.meta.url)
const profile = await mkdtemp(join(tmpdir(), 'slidemind-renderer-test-'))
const config = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve('electron.vite.config.ts'))
const server = await createServer({
  ...config.config.renderer,
  configFile: false,
  optimizeDeps: {
    ...config.config.renderer.optimizeDeps,
    entries: ['tests/renderer/index.html', 'src/renderer/pptist.html', 'tests/renderer/pptist-probe.js']
  },
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 0 },
  clearScreen: false
})
try {
  await server.listen()
  const address = server.httpServer.address()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [
    resolve('scripts/test-renderer-electron.cjs'),
    `http://127.0.0.1:${address.port}/tests/renderer/index.html`,
    profile,
    resolve('.local/renderer-tests')
  ], { stdio: 'inherit', env })
  const watchdog = setTimeout(() => {
    console.error('Renderer test process exceeded 180 seconds')
    child.kill('SIGKILL')
  }, 180_000)
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code ?? 1))
    })
  } finally {
    clearTimeout(watchdog)
  }
} finally {
  await server.close()
  await rm(profile, { recursive: true, force: true })
}
