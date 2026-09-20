import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const flags = new Set(process.argv.slice(2))
for (const flag of flags) {
  if (!['--unit', '--integration', '--live-web', '--packaged'].includes(flag)) {
    throw new Error(`Unknown test option: ${flag}`)
  }
}
const unit = flags.has('--unit')
const packaged = flags.has('--packaged')
if ((unit || packaged) && flags.size > 1) {
  throw new Error('--unit and --packaged must be used on their own')
}
const integration = flags.has('--integration')
if (integration && !['darwin', 'win32'].includes(process.platform)) {
  throw new Error('Runtime integration tests require macOS or Windows')
}
const env = { ...process.env }
if (integration) {
  await run('scripts/tika-p0/prepare-runtime.mjs')
  await run('scripts/pandoc-package/prepare.mjs')
  env.SLIDEMIND_TIKA_INTEGRATION = '1'
  env.SLIDEMIND_PANDOC_INTEGRATION = '1'
}
if (flags.has('--live-web')) env.SLIDEMIND_WEB_LIVE_TEST = '1'

if (packaged) {
  await run('scripts/tika-package/verify.mjs')
  await run('scripts/pandoc-package/verify.mjs')
  await run('scripts/agent-isolation/verify-package.mjs')
} else {
  await run(binary('vitest', 'vitest.mjs'), [
    'run',
    ...(unit
      ? [
          '--exclude',
          '**/*integration.test.ts',
          '--exclude',
          '**/web-live.test.ts',
        ]
      : []),
  ])
  if (!unit) {
    await run('scripts/agent-isolation/run.mjs')
    await run(binary('typescript', 'bin/tsc'), [
      '--noEmit',
      '-p',
      'tsconfig.web.json',
    ])
    await run('scripts/test-renderer.mjs')
    if (integration) {
      await run(binary('electron-vite', 'bin/electron-vite.js'), ['build'])
      await run('scripts/pdf-p3/run-local.mjs')
    }
  }
}

async function run(script, args = []) {
  console.log(`[test] ${script} ${args.join(' ')}`)
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: 'inherit',
      env,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${script} failed (${signal ?? code})`))
    })
  })
}

function binary(packageName, path) {
  return resolve(dirname(require.resolve(`${packageName}/package.json`)), path)
}
