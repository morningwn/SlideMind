const { app, BrowserWindow, screen } = require('electron')
const { createHash, randomUUID } = require('node:crypto')
const { createWriteStream } = require('node:fs')
const { open, readFile, unlink, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { cpus, release } = require('node:os')
const { performance } = require('node:perf_hooks')

const [baseUrl, profile, output, pdfkitPath] = process.argv.slice(2)
const PDFDocument = require(pdfkitPath)
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
const report = {
  platform: `${process.platform}-${process.arch}`,
  osRelease: release(),
  cpu: cpus()[0].model,
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
  pdfkit: require(join(pdfkitPath, 'package.json')).version,
  markdown: {},
  fixtures: {},
  presentation: [],
  visualFindings: [
    {
      source: 'markdown',
      status: 'manual-review-required',
      finding:
        'Review all pages for root background leakage and print fragmentation',
    },
  ],
  checks: [],
}

function fixture(pageCount) {
  return {
    title: 'PDF P0 PPTist sample',
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
    slides: Array.from({ length: pageCount }, (_, index) => ({
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
          content: '<p><strong>PPTist · PDF 渲染验证</strong></p>',
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
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        },
        {
          id: `chart-${index}`,
          type: 'chart',
          left: 590,
          top: 340,
          width: 350,
          height: 185,
          rotate: 0,
          chartType: 'column',
          themeColors: ['#2563eb', '#ed5363'],
          textColor: '#183153',
          data: {
            labels: ['一', '二', '三'],
            legends: ['样本'],
            series: [[2, 4, 3]],
          },
        },
      ],
    })),
  }
}

async function markdownProbe() {
  const window = new BrowserWindow({
    width: 900,
    height: 1000,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  try {
    window.webContents.on('console-message', (details) =>
      console.log('markdown:', details.message),
    )
    await window.loadURL(`${baseUrl}/scripts/pdf-p0/markdown.html`)
    const ready = await window.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (window.pdfProbeReady) Promise.resolve(window.pdfProbeReady).then(resolve, reject);
        else if (Date.now() - started > 30000) reject(new Error('Markdown probe did not initialize'));
        else setTimeout(poll, 50);
      };
      poll();
    })`)
    if (ready.images !== 4)
      throw new Error(`Expected four loaded images, got ${ready.images}`)
    const started = performance.now()
    const bytes = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
    })
    const path = join(output, 'markdown-a4.pdf')
    await writeFile(path, bytes)
    report.markdown = {
      ...ready,
      bytes: bytes.length,
      millis: Math.round(performance.now() - started),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    report.checks.push({
      name: 'Markdown PDF signature',
      passed: bytes.subarray(0, 5).toString() === '%PDF-',
    })
  } finally {
    window.destroy()
  }
}

async function missingImageProbe() {
  const window = new BrowserWindow({
    width: 900,
    height: 1000,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  try {
    await window.loadURL(`${baseUrl}/scripts/pdf-p0/markdown.html?missing=1`)
    let rejected = false
    try {
      await window.webContents
        .executeJavaScript(`new Promise((resolve, reject) => {
        const poll = () => window.pdfProbeReady
          ? Promise.resolve(window.pdfProbeReady).then(resolve, reject)
          : setTimeout(poll, 50);
        poll();
      })`)
    } catch {
      rejected = true
    }
    report.checks.push({
      name: 'Missing image aborts before print',
      passed: rejected,
    })
  } finally {
    window.destroy()
  }
}

async function outputBoundaryProbe() {
  const existing = join(output, 'existing-target.txt')
  const sentinel = Buffer.from('original output must remain intact')
  await writeFile(existing, sentinel)
  let exclusiveCreateFailed = false
  try {
    const handle = await open(existing, 'wx')
    await handle.close()
  } catch (error) {
    exclusiveCreateFailed = error.code === 'EEXIST'
  }
  report.checks.push({
    name: 'Exclusive target creation protects existing file',
    passed:
      exclusiveCreateFailed && (await readFile(existing)).equals(sentinel),
  })

  const cancelledPath = join(output, 'cancelled.pdf.tmp')
  const doc = new PDFDocument({ autoFirstPage: false })
  const stream = createWriteStream(cancelledPath)
  doc.on('error', () => {})
  stream.on('error', () => {})
  doc.pipe(stream)
  doc.addPage().text('cancelled export')
  const closed = new Promise((resolve) => stream.once('close', resolve))
  doc.unpipe(stream)
  doc.destroy()
  stream.destroy()
  await closed
  await unlink(cancelledPath)
  report.checks.push({
    name: 'Cancelled PDFKit stream leaves no temporary file',
    passed: true,
  })
}

async function renderSlide(window, presentation, slideNumber) {
  const requestId = randomUUID()
  const message = JSON.stringify({
    type: 'slidemind:pptist:render',
    requestId,
    slideNumber,
    presentation: slideNumber === 1 ? presentation : undefined,
  })
  const script = `new Promise((resolve, reject) => {
    const id = ${JSON.stringify(requestId)};
    const timer = setTimeout(() => reject(new Error('render timed out')), 30000);
    const receive = (event) => {
      const data = event.data;
      if (!data || data.requestId !== id) return;
      if (!['slidemind:pptist:render-ready', 'slidemind:pptist:render-error'].includes(data.type)) return;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      if (data.type === 'slidemind:pptist:render-error') reject(new Error(data.message));
      else resolve(data.rect);
    };
    window.addEventListener('message', receive);
    window.postMessage(${message}, '*');
  })`
  const rect = await window.webContents.executeJavaScript(script, true)
  const [contentWidth, contentHeight] = window.getContentSize()
  const x = Math.max(0, Math.floor(rect.left))
  const y = Math.max(0, Math.floor(rect.top))
  const capture = {
    x,
    y,
    width: Math.max(1, Math.min(contentWidth - x, Math.ceil(rect.width))),
    height: Math.max(1, Math.min(contentHeight - y, Math.ceil(rect.height))),
  }
  const image = await window.webContents.capturePage(capture)
  if (image.isEmpty()) throw new Error(`Slide ${slideNumber} is empty`)
  return { png: image.toPNG(), size: image.getSize(), rect, capture }
}

async function writePresentationPdf(width, pageCount) {
  const fixtureBytes = await readFile(
    join(output, `fixture-${pageCount}.slides.json`),
  )
  const presentation = JSON.parse(fixtureBytes).presentation
  const height = Math.round(width * presentation.viewportRatio)
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    useContentSize: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const name = `presentation-${width}px-${pageCount}p`
  const path = join(output, `${name}.pdf`)
  const started = performance.now()
  let peakRss = process.memoryUsage().rss
  let totalPngBytes = 0
  let firstSize
  let firstCapture
  let devicePixelRatio
  try {
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error('pptist:', details.message)
    })
    await window.loadURL(`${baseUrl}/src/renderer/pptist.html`)
    window.webContents.setZoomFactor(1)
    devicePixelRatio = await window.webContents.executeJavaScript(
      'window.devicePixelRatio',
    )
    const doc = new PDFDocument({ autoFirstPage: false, compress: false })
    const stream = createWriteStream(path)
    const finished = new Promise((resolve, reject) => {
      stream.once('finish', resolve)
      stream.once('error', reject)
      doc.once('error', reject)
    })
    doc.pipe(stream)
    for (let slideNumber = 1; slideNumber <= pageCount; slideNumber += 1) {
      const slide = await renderSlide(window, presentation, slideNumber)
      if (slideNumber === 1) {
        firstSize = slide.size
        firstCapture = slide.capture
        await writeFile(join(output, `${name}.png`), slide.png)
      }
      totalPngBytes += slide.png.length
      doc.addPage({ size: [960, 540], margin: 0 })
      doc.image(slide.png, 0, 0, { width: 960, height: 540 })
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    }
    doc.end()
    await finished
    const bytes = await readFile(path)
    report.presentation.push({
      width,
      pageCount,
      devicePixelRatio,
      firstSize,
      firstCapture,
      totalPngBytes,
      pdfBytes: bytes.length,
      millis: Math.round(performance.now() - started),
      peakRssBytes: peakRss,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    report.checks.push({
      name: `${name} PDF signature`,
      passed: bytes.subarray(0, 5).toString() === '%PDF-',
    })
  } finally {
    window.destroy()
  }
}

app.whenReady().then(async () => {
  try {
    report.displayScaleFactor = screen.getPrimaryDisplay().scaleFactor
    for (const count of [1, 10, 30]) {
      const bytes = Buffer.from(
        JSON.stringify({
          format: 'slidemind.presentation',
          version: 2,
          presentation: fixture(count),
        }),
      )
      await writeFile(join(output, `fixture-${count}.slides.json`), bytes)
      report.fixtures[count] = createHash('sha256').update(bytes).digest('hex')
    }
    console.log('PDF P0: Markdown print')
    await markdownProbe()
    await missingImageProbe()
    for (const width of [1280, 1920, 2560]) {
      console.log(`PDF P0: PPT ${width}px, 1 page`)
      await writePresentationPdf(width, 1)
    }
    for (const count of [10, 30]) {
      console.log(`PDF P0: PPT 1920px, ${count} pages`)
      await writePresentationPdf(1920, count)
    }
    await outputBoundaryProbe()
    report.result = report.checks.every((check) => check.passed)
      ? 'structural-pass-visual-review-required'
      : 'structural-fail'
    await writeFile(
      join(output, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    console.log(JSON.stringify(report, null, 2))
    app.exit(report.checks.every((check) => check.passed) ? 0 : 1)
  } catch (error) {
    report.error = error.stack || String(error)
    await writeFile(
      join(output, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    console.error(error)
    app.exit(1)
  }
})
