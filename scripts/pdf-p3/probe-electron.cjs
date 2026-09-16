const { app, BrowserWindow, dialog } = require('electron')
const { createHash } = require('node:crypto')
const { mkdir, readFile, readdir, writeFile } = require('node:fs/promises')
const { cpus, release } = require('node:os')
const { join, resolve } = require('node:path')

const [profile, output, appPath] = process.argv.slice(2)
const project = join(output, 'project')
const outputs = [join(output, 'markdown.pdf'), join(output, 'presentation.pdf')]
app.setPath('userData', profile)
app.getAppPath = () => appPath
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] })
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: outputs.shift(),
})

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function mainWindow() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((entry) =>
      entry.webContents.getURL().endsWith('/renderer/index.html'),
    )
    if (window && !window.webContents.isLoading()) return window
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Main window did not load')
}

function presentation() {
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  return {
    format: 'slidemind.presentation',
    version: 2,
    presentation: {
      title: 'PDF P3 local acceptance',
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: {
        backgroundColor: '#ffffff',
        themeColors: ['#2563eb'],
        fontColor: '#183153',
        fontName: 'Arial',
        outline: { width: 2, color: '#525252', style: 'solid' },
        shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
      },
      slides: Array.from({ length: 30 }, (_, index) => ({
        id: `slide-${index}`,
        background: { type: 'solid', color: '#f4f7fc' },
        elements: [
          {
            id: `shape-${index}`,
            type: 'shape',
            left: 680,
            top: 150,
            width: 210,
            height: 150,
            rotate: 0,
            viewBox: [200, 200],
            path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
            fixedRatio: false,
            fill: '#ed5363',
            opacity: 0.55,
          },
          {
            id: `title-${index}`,
            type: 'text',
            left: 80,
            top: 70,
            width: 820,
            height: 70,
            rotate: 0,
            content: '<p><strong>PPTist · PDF P3 验收</strong></p>',
            defaultFontName: 'Arial',
            defaultColor: '#183153',
          },
          {
            id: `body-${index}`,
            type: 'text',
            left: 80,
            top: 200,
            width: 650,
            height: 170,
            rotate: 0,
            content: `<p>第 ${index + 1} 页 · 中文、English、叠放顺序</p><p><span style="color: #2563eb">颜色和透明度检查</span></p>`,
            defaultFontName: 'Arial',
            defaultColor: '#183153',
          },
          {
            id: `image-${index}`,
            type: 'image',
            left: 740,
            top: 195,
            width: 90,
            height: 90,
            rotate: 0,
            fixedRatio: true,
            src: image,
          },
        ],
      })),
    },
  }
}

async function run() {
  const window = await mainWindow()
  await mkdir(join(project, 'images'), { recursive: true })
  const images = await window.webContents.executeJavaScript(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 100
    const context = canvas.getContext('2d')
    return ['png', 'jpeg', 'webp'].map((format) => {
      context.fillStyle = format === 'png' ? '#2962b7' : format === 'jpeg' ? '#a64444' : '#38825a'
      context.fillRect(0, 0, 320, 100)
      context.fillStyle = '#fff'
      context.font = 'bold 28px Arial'
      context.fillText(format.toUpperCase(), 22, 62)
      return [format, canvas.toDataURL('image/' + format).split(',')[1]]
    })
  })()`)
  images.push(['gif', 'R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='])
  for (const [extension, data] of images) {
    await writeFile(
      join(project, 'images', `sample.${extension}`),
      Buffer.from(data, 'base64'),
    )
  }
  const rows = Array.from(
    { length: 16 },
    (_, index) =>
      `| 第 ${index + 1} 行 | 中文与 English 交错内容 | https://example.invalid/a/very/long/path/that/should/wrap |`,
  ).join('\n')
  const code = Array.from(
    { length: 28 },
    (_, index) => `const line${index} = '中文 English ${'x'.repeat(70)}'`,
  ).join('\n')
  const markdown = `# PDF 导出中文样本\n\n## 标题层级和正文\n\n中文字体、**强调**、[链接](https://example.invalid/)与背景色。\n\n- 第一层\n  - 嵌套列表\n    - 第三层\n\n### 长表格\n\n| 序号 | 内容 | 长链接 |\n|---|---|---|\n${rows}\n\n### 长代码\n\n\`\`\`ts\n${code}\n\`\`\`\n\n### 图片\n\n![PNG](images/sample.png)\n\n![JPEG](images/sample.jpeg)\n\n![GIF](images/sample.gif)\n\n![WebP](images/sample.webp)\n\n## 跨页段落\n\n${'这是需要跨页的中文段落，保留阅读顺序和分页。'.repeat(70)}\n`
  const deck = JSON.stringify(presentation())
  await writeFile(join(project, '验收文档.md'), markdown)
  await writeFile(join(project, '验收演示.slides.json'), deck)

  const opened = await window.webContents.executeJavaScript(
    'window.projects.chooseFolder()',
  )
  if (!opened?.handle) throw new Error('Project authorization failed')
  const startedAt = Date.now()
  const markdownResult = await window.webContents.executeJavaScript(
    `window.documentExport.exportPdf(${JSON.stringify(opened.handle)}, ${JSON.stringify({ path: '验收文档.md', content: markdown })})`,
  )
  const markdownMs = Date.now() - startedAt
  if (markdownResult.status !== 'exported') {
    throw new Error(`Markdown export failed: ${JSON.stringify(markdownResult)}`)
  }
  const presentationStartedAt = Date.now()
  const presentationResult = await window.webContents.executeJavaScript(
    `window.presentations.exportPdf(${JSON.stringify(opened.handle)}, { path: '验收演示.slides.json' })`,
  )
  const presentationMs = Date.now() - presentationStartedAt
  if (presentationResult.status !== 'exported') {
    throw new Error(
      `Presentation export failed: ${JSON.stringify(presentationResult)}`,
    )
  }
  outputs.push(join(output, 'missing-image.pdf'))
  const missingImageResult = await window.webContents.executeJavaScript(
    `window.documentExport.exportPdf(${JSON.stringify(opened.handle)}, { path: '验收文档.md', content: '![Missing](images/missing.png)' })`,
  )
  if (missingImageResult.status !== 'failed') {
    throw new Error(
      `Missing image was not rejected: ${JSON.stringify(missingImageResult)}`,
    )
  }
  outputs.push(join(output, 'cancelled.pdf'))
  const cancelWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(appPath, 'out/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  await cancelWindow.loadFile(join(appPath, 'out/renderer/index.html'))
  const pending = cancelWindow.webContents
    .executeJavaScript(
      `window.presentations.exportPdf(${JSON.stringify(opened.handle)}, { path: '验收演示.slides.json' })`,
    )
    .catch(() => undefined)
  for (let attempt = 0; outputs.length > 0; attempt += 1) {
    if (attempt === 100) throw new Error('Cancellation export did not start')
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  cancelWindow.destroy()
  void pending
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const files = await readdir(output)
    if (
      BrowserWindow.getAllWindows().length === 1 &&
      !files.includes('cancelled.pdf') &&
      !files.some((name) => name.endsWith('.slidemind-tmp'))
    ) {
      break
    }
    if (attempt === 99)
      throw new Error('Closed window left PDF output or renderer')
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (BrowserWindow.getAllWindows().length !== 1) {
    throw new Error('Hidden export window remained open')
  }
  const outputFiles = await readdir(output)
  if (outputFiles.includes('missing-image.pdf')) {
    throw new Error('Failed export left a PDF')
  }
  const leftovers = outputFiles.filter((name) =>
    name.endsWith('.slidemind-tmp'),
  )
  if (leftovers.length)
    throw new Error(`Temporary PDF remained: ${leftovers.join(', ')}`)
  const markdownPdf = await readFile(join(output, 'markdown.pdf'))
  const presentationPdf = await readFile(join(output, 'presentation.pdf'))
  const report = {
    platform: `${process.platform}-${process.arch}`,
    osRelease: release(),
    cpu: cpus()[0].model,
    productVersion: require(resolve('package.json')).version,
    electronAppVersion: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    mode: appPath.endsWith('.asar')
      ? 'packaged-asar-in-test-shell'
      : 'production-build-unpackaged',
    markdown: {
      sourceSha256: sha256(markdown),
      imageSha256: Object.fromEntries(
        images.map(([extension, data]) => [
          extension,
          sha256(Buffer.from(data, 'base64')),
        ]),
      ),
      pdfSha256: sha256(markdownPdf),
      bytes: markdownPdf.length,
      millis: markdownMs,
      pageCount: markdownResult.pageCount,
    },
    presentation: {
      sourceSha256: sha256(deck),
      pdfSha256: sha256(presentationPdf),
      bytes: presentationPdf.length,
      millis: presentationMs,
      pageCount: presentationResult.pageCount,
    },
    missingImage: {
      status: missingImageResult.status,
      leftOutput: false,
    },
    closeDuringExport: { leftOutput: false, leftWindow: false },
  }
  await writeFile(
    join(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report, null, 2))
}

require(join(appPath, 'out/main/index.js'))
app.whenReady().then(async () => {
  try {
    await run()
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
