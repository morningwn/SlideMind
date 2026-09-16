const { app, BrowserWindow } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { cpus, release } = require('node:os')
const [url, profile, output] = process.argv.slice(2)
app.setPath('userData', profile)
const timeout = setTimeout(() => { console.error('Renderer suite timed out'); app.exit(1) }, 180_000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440, height: 1000, show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  const errors = []
  let markdownExportScreenshot = Promise.resolve()
  window.webContents.on('page-title-updated', (_event, title) => {
    if (title !== 'SlideMind renderer tests - markdown export ready') return
    markdownExportScreenshot = window.webContents.capturePage().then((image) =>
      writeFile(join(output, 'markdown-word-export.png'), image.toPNG())
    )
  })
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message)
    if (details.level === 'error' || details.message.startsWith('[test]')) console.log(details.message)
  })
  try {
    await mkdir(output, { recursive: true })
    await window.loadURL(url)
    const result = await window.webContents.executeJavaScript('window.rendererTestResult')
    await markdownExportScreenshot
    if (errors.length) result.error = [result.error, ...errors].filter(Boolean).join('\n')
    await writeFile(join(output, 'results.json'), JSON.stringify({ ...result, chromium: process.versions.chrome, electron: process.versions.electron, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0].model }, null, 2))
    await writeFile(join(output, result.error ? 'failure.png' : 'pptist.png'), (await window.webContents.capturePage()).toPNG())
    console.log(JSON.stringify(result, null, 2))
    console.log(`Renderer artifacts: ${output}`)
    app.exit(result.error ? 1 : 0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  } finally {
    clearTimeout(timeout)
  }
})
