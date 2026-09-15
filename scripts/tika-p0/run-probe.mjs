import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { release, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const runtimeRoot = resolve(readOption('--runtime') ?? join(repositoryRoot, 'out/.tika-p0-runtime', `${process.platform}-${process.arch}`))
const prepared = JSON.parse(await readFile(join(runtimeRoot, 'prepared-runtime.json'), 'utf8'))
prepared.javaBinary = resolve(runtimeRoot, prepared.javaBinary)
prepared.tikaJar = resolve(runtimeRoot, prepared.tikaJar)
const fixtureRoot = join(repositoryRoot, 'scripts/tika-p0/fixtures')
const reportPath = resolve(readOption('--report') ?? join(repositoryRoot, '.local/tika-p0-probe.json'))
const port = await reservePort()
const serverId = `slidemind-p0-${randomUUID()}`
const workRoot = await mkdtemp(join(tmpdir(), 'slidemind-tika-p0-'))
const startedAt = performance.now()
const stderr = []
const env = minimalEnvironment(workRoot)
const child = spawn(prepared.javaBinary, [
  '-Xmx256m',
  `-Djava.io.tmpdir=${workRoot}`,
  '-jar',
  prepared.tikaJar,
  '-c',
  join(scriptDirectory, 'tika-config.json'),
  '-h',
  '127.0.0.1',
  '-p',
  String(port),
  '-i',
  serverId
], {
  cwd: dirname(prepared.tikaJar),
  detached: process.platform !== 'win32',
  env,
  stdio: ['ignore', 'ignore', 'pipe']
})
child.stderr.setEncoding('utf8')
child.stderr.on('data', (value) => {
  if (stderr.join('').length < 65536) stderr.push(value)
})

const report = {
  schemaVersion: 1,
  platform: `${process.platform}-${process.arch}`,
  osVersion: release(),
  nodeVersion: process.version,
  tikaVersion: prepared.tikaVersion,
  javaVersion: prepared.javaVersion,
  tikaPgpVerified: prepared.tikaPgpVerified,
  threatModel: {
    trustedLocalNativeProcesses: true,
    sharedMultiUserHostIsolation: false,
    unauthenticatedLoopbackAccepted: true
  },
  serverId,
  runtimeBytes: prepared.runtimeBytes,
  tests: [],
  samples: [],
  measurements: {},
  result: 'incomplete'
}

try {
  await waitForServer(port, child)
  report.measurements.coldStartMillis = Math.round(performance.now() - startedAt)
  await probeAccessControls()
  await probeSamples()
  await probeRecovery()
  await probeForkCrashRecovery()
  report.measurements.processTree = await processTree(child.pid)
} finally {
  const ownedPids = report.measurements.processTree?.processes?.map((process) => process.pid) ?? [child.pid]
  await terminateTree(child)
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  const remainingPids = ownedPids.filter(isProcessAlive)
  addTest('owned process tree is reclaimed on shutdown', remainingPids.length === 0, { remainingPids })
  report.measurements.totalMillis = Math.round(performance.now() - startedAt)
  report.stderrTail = redactStderr(stderr.join('')).slice(-12000)
  report.result = report.tests.every((test) => test.passed) ? 'pass' : 'blocked'
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  await rm(workRoot, { recursive: true, force: true })
}

console.log(JSON.stringify({ reportPath, result: report.result, tests: report.tests }, null, 2))
if (report.result !== 'pass') process.exitCode = 1

async function probeAccessControls() {
  const version = await request('/version')
  addTest('version endpoint is pinned', version.status === 200 && version.text.includes(prepared.tikaVersion), {
    status: version.status,
    response: version.text.trim()
  })

  const unauthenticated = await request('/version')
  addTest('unauthenticated loopback access matches the accepted threat model', unauthenticated.status === 200, {
    status: unauthenticated.status,
    acceptedRisk: 'Native processes running as the same OS user are trusted callers; shared-host isolation is out of scope.'
  })

  const cors = await request('/version', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.invalid',
      'Access-Control-Request-Method': 'GET'
    }
  })
  addTest('untrusted browser origin receives no CORS grant', !cors.headers['access-control-allow-origin'], {
    status: cors.status,
    allowOrigin: cors.headers['access-control-allow-origin'] ?? null
  })

  const config = await request('/tika/config/text', { method: 'POST', body: new Uint8Array() })
  addTest('per-request parser configuration is disabled', config.status === 403 || config.status === 404, {
    status: config.status
  })

  const pipes = await request('/pipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  })
  addTest('fetcher and emitter endpoint is disabled', pipes.status === 403 || pipes.status === 404, {
    status: pipes.status
  })
}

async function probeSamples() {
  const expectations = JSON.parse(await readFile(join(fixtureRoot, 'expectations.json'), 'utf8'))
  for (const sample of expectations.samples) {
    const path = join(fixtureRoot, sample.file)
    const bytes = await readFile(path)
    const detected = await request('/detect', {
      method: 'PUT',
      headers: { 'Content-Disposition': `attachment; filename="${sample.file}"` },
      body: bytes
    })
    const parseStartedAt = performance.now()
    const parsed = await request('/rmeta/text', {
      method: 'PUT',
      headers: { 'Content-Disposition': `attachment; filename="${sample.file}"` },
      body: bytes
    })
    const parseMillis = Math.round(performance.now() - parseStartedAt)
    let entries = []
    try {
      const value = JSON.parse(parsed.text)
      entries = Array.isArray(value) ? value : []
    } catch {}
    const content = entries.map((entry) => entry['tk:content'] ?? '').join('\n')
    const missing = sample.requiredText.filter((value) => !content.includes(value))
    const outOfOrder = (sample.orderedTextGroups ?? []).filter((group) => {
      let offset = -1
      for (const value of group) {
        offset = content.indexOf(value, offset + 1)
        if (offset === -1) return true
      }
      return false
    })
    report.samples.push({
      file: sample.file,
      bytes: (await stat(path)).size,
      detectedMimeType: detected.text.trim(),
      detectStatus: detected.status,
      parseStatus: parsed.status,
      parseMillis,
      metadataKeys: entries[0] ? Object.keys(entries[0]).sort() : [],
      contentChars: content.length,
      missingRequiredText: missing,
      outOfOrder,
      knownLimitations: sample.knownLimitations
    })
    addTest(`sample ${sample.file} extracts required text`, detected.status === 200 && parsed.status === 200 && missing.length === 0 && outOfOrder.length === 0, {
      detectedMimeType: detected.text.trim(),
      missingRequiredText: missing,
      outOfOrder,
      contentChars: content.length
    })
  }
}

async function probeRecovery() {
  const before = await request('/version')
  const controller = new AbortController()
  const bytes = await readFile(join(fixtureRoot, 'complex-content.docx'))
  const pending = fetch(`http://127.0.0.1:${port}/rmeta/text`, {
    method: 'PUT',
    body: bytes,
    signal: controller.signal
  }).catch((error) => error.name)
  controller.abort()
  await pending
  const after = await request('/version')
  addTest('server remains responsive after client cancellation', before.status === 200 && after.status === 200, {
    beforeStatus: before.status,
    afterStatus: after.status
  })
}

async function probeForkCrashRecovery() {
  if (process.platform === 'win32') {
    addTest('server replaces a crashed parse fork', false, { pending: 'Windows runner not implemented' })
    return
  }
  const before = await processTree(child.pid)
  const worker = before.processes.find((process) => process.ppid === child.pid)
  if (!worker) {
    addTest('server replaces a crashed parse fork', false, { finding: 'No parse fork was observable' })
    return
  }
  process.kill(worker.pid, 'SIGKILL')
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
  const bytes = await readFile(join(fixtureRoot, 'simple-content.docx'))
  let response = await request('/rmeta/text', {
    method: 'PUT',
    headers: { 'Content-Disposition': 'attachment; filename="simple-content.docx"' },
    body: bytes
  })
  if (response.status !== 200) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    response = await request('/rmeta/text', {
      method: 'PUT',
      headers: { 'Content-Disposition': 'attachment; filename="simple-content.docx"' },
      body: bytes
    })
  }
  const after = await processTree(child.pid)
  const replacement = after.processes.find((process) => process.ppid === child.pid && process.pid !== worker.pid)
  addTest('server replaces a crashed parse fork', response.status === 200 && Boolean(replacement), {
    responseStatus: response.status,
    originalForkExited: !isProcessAlive(worker.pid),
    replacementObserved: Boolean(replacement)
  })
}

function addTest(name, passed, evidence) {
  report.tests.push({ name, passed, evidence })
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(10000)
  })
  const headers = Object.fromEntries(response.headers.entries())
  return { status: response.status, headers, text: await response.text() }
}

async function waitForServer(port, processHandle) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`Tika exited during startup with ${processHandle.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/version`, { signal: AbortSignal.timeout(500) })
      if (response.ok && (await response.text()).includes(prepared.tikaVersion)) return
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Tika startup exceeded 30 seconds')
}

async function reservePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error ? reject(error) : resolvePromise(address.port))
    })
  })
}

function minimalEnvironment(home) {
  const keep = ['PATH', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']
  const javaHome = dirname(dirname(prepared.javaBinary))
  const env = {
    HOME: home,
    JAVA_HOME: javaHome,
    TMP: home,
    TEMP: home,
    TMPDIR: home
  }
  for (const key of keep) if (process.env[key]) env[key] = process.env[key]
  env.PATH = `${dirname(prepared.javaBinary)}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`
  env.NO_PROXY = '127.0.0.1,localhost'
  env.no_proxy = env.NO_PROXY
  return env
}

async function processTree(parentPid) {
  if (process.platform === 'win32') return { supported: false, reason: 'Windows process-tree measurement pending native runner' }
  return new Promise((resolvePromise) => {
    const ps = spawn('ps', ['-axo', 'pid=,ppid=,rss=,command='])
    let output = ''
    ps.stdout.setEncoding('utf8')
    ps.stdout.on('data', (value) => { output += value })
    ps.once('exit', () => {
      const rows = output.trim().split('\n').map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
        return match ? { pid: Number(match[1]), ppid: Number(match[2]), rssKiB: Number(match[3]), command: match[4] } : null
      }).filter(Boolean)
      const pids = new Set([parentPid])
      let changed = true
      while (changed) {
        changed = false
        for (const row of rows) if (pids.has(row.ppid) && !pids.has(row.pid)) {
          pids.add(row.pid)
          changed = true
        }
      }
      const tree = rows.filter((row) => pids.has(row.pid)).map((row) => ({
        pid: row.pid,
        ppid: row.ppid,
        rssKiB: row.rssKiB,
        role: row.pid === parentPid ? 'server' : 'fork'
      }))
      resolvePromise({ supported: true, peakUnavailable: true, totalRssKiB: tree.reduce((sum, row) => sum + row.rssKiB, 0), processes: tree })
    })
  })
}

async function terminateTree(processHandle) {
  if (processHandle.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(processHandle.pid), '/t', '/f'])
      killer.once('exit', resolvePromise)
    })
  } else {
    try { process.kill(-processHandle.pid, 'SIGTERM') } catch {}
    await Promise.race([
      new Promise((resolvePromise) => processHandle.once('exit', resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 3000))
    ])
    if (processHandle.exitCode === null) try { process.kill(-processHandle.pid, 'SIGKILL') } catch {}
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function redactStderr(value) {
  return value
    .replaceAll(repositoryRoot, '<repository>')
    .replaceAll(runtimeRoot, '<runtime>')
    .replaceAll(workRoot, '<work>')
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
