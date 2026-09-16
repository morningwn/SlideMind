import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { release, tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const runtimeRoot = resolve(
  readOption('--runtime') ??
    join(
      repositoryRoot,
      'out/.pandoc-p0-runtime',
      `${process.platform}-${process.arch}`,
    ),
)
const reportPath = resolve(
  readOption('--report') ?? join(repositoryRoot, '.local/pandoc-p0-probe.json'),
)
const referencePath = resolve(
  readOption('--reference') ??
    join(repositoryRoot, 'assets/document-export/reference.docx'),
)
const prepared = JSON.parse(
  await readFile(join(runtimeRoot, 'prepared-runtime.json'), 'utf8'),
)
if (!prepared.executionVerified) {
  throw new Error(
    'The selected runtime was not executed on its target platform',
  )
}
const pandoc = resolve(runtimeRoot, prepared.binary)
const fixtureRoot = join(scriptDirectory, 'fixtures')
const workRoot = await mkdtemp(join(tmpdir(), 'slidemind-pandoc-p0-'))
const report = {
  schemaVersion: 1,
  platform: `${process.platform}-${process.arch}`,
  osVersion: release(),
  nodeVersion: process.version,
  pandocVersion: prepared.pandocVersion,
  runtimeBytes: prepared.runtimeBytes,
  archiveBytes: prepared.archiveBytes,
  referenceBytes: 0,
  referenceSha256: null,
  tests: [],
  measurements: {},
  findings: [],
  result: 'incomplete',
}

try {
  await mkdir(dirname(reportPath), { recursive: true })
  await createReferenceDocument()
  report.referenceBytes = (await stat(referencePath)).size
  report.referenceSha256 = createHash('sha256')
    .update(await readFile(referencePath))
    .digest('hex')
  await probeCleanDocument()
  await probeUnsupportedContent()
  await probeHeapLimit()
} finally {
  report.result = report.tests.every((test) => test.passed) ? 'pass' : 'blocked'
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  await rm(workRoot, { recursive: true, force: true })
}

console.log(
  JSON.stringify(
    { reportPath, result: report.result, tests: report.tests },
    null,
    2,
  ),
)
if (report.result !== 'pass') process.exitCode = 1

async function createReferenceDocument() {
  const entries = await unzipList(referencePath)
  const styles = await unzipRead(referencePath, 'word/styles.xml')
  const document = await unzipRead(referencePath, 'word/document.xml')
  const core = await unzipRead(referencePath, 'docProps/core.xml')
  addTest(
    'reference document declares an East Asian font, A4 page, margins, and clean metadata',
    entries.includes('word/styles.xml') &&
      styles.includes('Arial Unicode MS') &&
      document.includes('11906') &&
      document.includes('16838') &&
      !core.match(/<dc:creator>[^<]+/) &&
      !core.match(/<cp:lastModifiedBy>[^<]+/),
    { entries: entries.length },
  )
}

async function probeCleanDocument() {
  const markdown = await readFile(join(fixtureRoot, 'content.md'), 'utf8')
  const parse = await runPandoc(
    ['--sandbox', '--from=gfm', '--to=json', ...heapLimitArguments()],
    markdown,
  )
  report.measurements.parseMillis = parse.durationMillis
  report.measurements.parsePeakRssKiB = parse.peakRssKiB
  addTest('GFM parses to JSON AST in sandbox mode', parse.code === 0, {
    stderr: parse.stderr,
  })
  if (parse.code !== 0) return

  const ast = JSON.parse(parse.stdout)
  const images = findNodes(ast, 'Image')
  const rawNodes = [
    ...findNodes(ast, 'RawBlock'),
    ...findNodes(ast, 'RawInline'),
  ]
  addTest(
    'clean fixture exposes one image and no raw HTML nodes',
    images.length === 1 && rawNodes.length === 0,
    { images: images.length, rawNodes: rawNodes.length },
  )
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  const imageTarget = images[0]?.c?.[2]
  if (!Array.isArray(imageTarget) || imageTarget[0] !== 'images/pixel.png') {
    addTest('image target can be rewritten by the application', false, {
      imageTarget,
    })
    return
  }
  imageTarget[0] = `data:image/png;base64,${pixel.toString('base64')}`
  addTest('image target can be rewritten by the application', true, {
    source: 'images/pixel.png',
    mediaType: 'image/png',
    bytes: pixel.length,
  })

  const outputPath = join(workRoot, 'clean.docx')
  const write = await runPandoc(
    [
      '--sandbox',
      '--from=json',
      '--to=docx',
      `--reference-doc=${referencePath}`,
      '--output',
      outputPath,
      ...heapLimitArguments(),
    ],
    JSON.stringify(ast),
  )
  report.measurements.writeMillis = write.durationMillis
  report.measurements.writePeakRssKiB = write.peakRssKiB
  addTest(
    'sandboxed JSON writer accepts the bundled reference and data URI image',
    write.code === 0,
    { stderr: write.stderr },
  )
  if (write.code !== 0) return

  const outputEntries = await unzipList(outputPath)
  const documentXml = await unzipRead(outputPath, 'word/document.xml')
  const mediaEntries = outputEntries.filter((entry) =>
    entry.startsWith('word/media/'),
  )
  addTest(
    'DOCX contains editable structure and embedded image media',
    documentXml.includes('<w:tbl>') &&
      documentXml.includes('<w:numPr>') &&
      documentXml.includes('SourceCode') &&
      documentXml.includes('SLIDEMIND_PANDOC_P0_END') &&
      mediaEntries.length === 1,
    {
      outputBytes: (await stat(outputPath)).size,
      mediaEntries,
    },
  )
}

async function probeUnsupportedContent() {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(200, { 'Content-Type': 'image/png' })
    response.end('must not be fetched')
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  try {
    const fixture = (
      await readFile(join(fixtureRoot, 'unsupported.md'), 'utf8')
    ).replace('PROBE_PORT', String(address.port))
    const parse = await runPandoc(
      ['--sandbox', '--from=gfm', '--to=json', ...heapLimitArguments()],
      fixture,
    )
    addTest(
      'unsupported fixture parses without resource IO',
      parse.code === 0,
      {
        stderr: parse.stderr,
      },
    )
    if (parse.code !== 0) return
    const ast = JSON.parse(parse.stdout)
    const rawNodes = [
      ...findNodes(ast, 'RawBlock'),
      ...findNodes(ast, 'RawInline'),
    ]
    const targets = findNodes(ast, 'Image').map((node) => node.c?.[2]?.[0])
    addTest(
      'AST exposes raw HTML and all unsafe image targets for application rejection',
      rawNodes.length > 0 &&
        targets.includes('/private/etc/passwd') &&
        targets.includes('../../outside.png') &&
        targets.some((target) => target?.startsWith('http://127.0.0.1:')),
      { rawNodes: rawNodes.length, targets },
    )

    const outputPath = join(workRoot, 'unsafe.docx')
    const write = await runPandoc(
      [
        '--sandbox',
        '--from=json',
        '--to=docx',
        `--reference-doc=${referencePath}`,
        '--output',
        outputPath,
        ...heapLimitArguments(),
      ],
      JSON.stringify(ast),
    )
    const outputText =
      write.code === 0 ? await extractDocxTextForProbe(outputPath) : ''
    addTest(
      'sandboxed writer performs no network request or local file disclosure',
      requests === 0 && !outputText.includes('root:x:'),
      {
        writerExitCode: write.code,
        requests,
        stderr: write.stderr,
      },
    )
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
}

async function probeHeapLimit() {
  const result = await runPandoc(
    ['--sandbox', '--from=gfm', '--to=json', ...heapLimitArguments()],
    '# heap limit probe',
  )
  addTest('fixed RTS heap limit is accepted', result.code === 0, {
    arguments: heapLimitArguments(),
    stderr: result.stderr,
  })
}

function heapLimitArguments() {
  return ['+RTS', '-M512m', '-RTS']
}

function findNodes(value, type) {
  const results = []
  visit(value)
  return results

  function visit(current) {
    if (!current || typeof current !== 'object') return
    if (current.t === type) results.push(current)
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    for (const nested of Object.values(current)) visit(nested)
  }
}

async function runPandoc(args, input) {
  return runProcess(pandoc, args, {
    input,
    cwd: workRoot,
    env: minimalEnvironment(),
    maxStdoutBytes: 64 * 1024 * 1024,
    maxStderrBytes: 64 * 1024,
    timeoutMillis: 60_000,
  })
}

async function runProcess(command, args, options) {
  const startedAt = performance.now()
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let peakRssKiB = null
    let timedOut = false
    let outputExceeded = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMillis ?? 60_000)
    const sampler =
      process.platform === 'win32' || command === 'ps'
        ? null
        : setInterval(async () => {
            const rss = await readRss(child.pid)
            if (rss !== null) peakRssKiB = Math.max(peakRssKiB ?? 0, rss)
          }, 20)

    child.stdout.on('data', (value) => {
      stdoutBytes += value.length
      if (stdoutBytes <= (options.maxStdoutBytes ?? 1024 * 1024)) {
        stdout.push(value)
      } else {
        outputExceeded = true
        child.kill('SIGKILL')
      }
    })
    child.stderr.on('data', (value) => {
      stderrBytes += value.length
      if (stderrBytes <= (options.maxStderrBytes ?? 64 * 1024)) {
        stderr.push(value)
      }
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      if (sampler) clearInterval(sampler)
      resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMillis: Math.round(performance.now() - startedAt),
        peakRssKiB,
        timedOut,
        outputExceeded,
      })
    })
    if (options.input === null) child.stdin.end()
    else child.stdin.end(options.input)
  })
}

async function readRss(pid) {
  if (!pid) return null
  try {
    const result = await runProcess('ps', ['-o', 'rss=', '-p', String(pid)], {
      input: null,
      timeoutMillis: 1000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    })
    const value = Number.parseInt(result.stdout.trim(), 10)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function minimalEnvironment() {
  const env = {
    HOME: workRoot,
    TMP: workRoot,
    TEMP: workRoot,
    TMPDIR: workRoot,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'en_US.UTF-8',
    PATH: dirname(pandoc),
    XDG_CONFIG_HOME: join(workRoot, 'config'),
    XDG_DATA_HOME: join(workRoot, 'data'),
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  }
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
  if (process.env.WINDIR) env.WINDIR = process.env.WINDIR
  return env
}

async function unzipList(path) {
  const result = await runProcess('tar', ['-tf', path], { input: null })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

async function unzipRead(path, entry) {
  const result = await runProcess('tar', ['-xOf', path, entry], {
    input: null,
    maxStdoutBytes: 16 * 1024 * 1024,
  })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout
}

async function extractDocxTextForProbe(path) {
  const result = await runProcess('tar', ['-xOf', path], {
    input: null,
    maxStdoutBytes: 64 * 1024 * 1024,
  })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout
}

function addTest(name, passed, evidence) {
  report.tests.push({ name, passed, evidence })
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
