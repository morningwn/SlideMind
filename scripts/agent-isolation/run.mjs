import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { build } from 'vite'

const packagedArgument = process.argv.indexOf('--packaged')
const packagedDirectory =
  packagedArgument === -1
    ? undefined
    : resolve(process.argv[packagedArgument + 1])
const resources = packagedDirectory
  ? join(
      packagedDirectory,
      ...(process.platform === 'darwin'
        ? ['Contents', 'Resources']
        : ['resources']),
    )
  : undefined
const executable = packagedDirectory
  ? join(
      packagedDirectory,
      ...(process.platform === 'darwin'
        ? ['Contents', 'MacOS', 'SlideMind']
        : ['SlideMind.exe']),
    )
  : process.execPath
const output = resolve('.local/agent-isolation')
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: true,
    target: 'node22',
    outDir: output,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve('tests/agent/managed-isolation.ts'),
      external: (id) =>
        (!id.startsWith('.') && !id.startsWith('/') && !id.includes(':')) ||
        id.startsWith('node:'),
      output: { format: 'cjs', entryFileNames: 'probe.cjs' },
    },
  },
})
const root = await realpath(
  await mkdtemp(join(tmpdir(), 'slidemind-isolation-')),
)
try {
  const home = join(root, 'home')
  const project = join(root, 'project')
  const agent = join(root, 'managed-agent')
  const foreign = join(root, 'foreign')
  for (const path of [home, project, agent, foreign]) await mkdir(path)
  const files = [
    ...[
      'settings.json',
      'auth.json',
      'models.json',
      'permissions.json',
      'SYSTEM.md',
      'APPEND_SYSTEM.md',
      'AGENTS.md',
      'skills/external/SKILL.md',
      'extensions/external.mjs',
      'prompts/external.md',
    ].flatMap((file) => [
      join(home, '.pi/agent', file),
      join(project, '.pi', file),
      join(foreign, file),
    ]),
    ...['AGENTS.md', 'SYSTEM.md', 'APPEND_SYSTEM.md'].flatMap((file) => [
      join(home, file),
      join(project, file),
      join(root, file),
    ]),
    join(home, '.config/gcloud/application_default_credentials.json'),
    join(home, '.aws/credentials'),
    join(home, '.codex/auth.json'),
    join(home, '.pi/free.json'),
    join(home, '.pi/web-search.json'),
  ]
  for (const file of files) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(
      file,
      file.endsWith('.json')
        ? JSON.stringify({
            marker: 'UNTRUSTED_CONFIGURATION',
            compaction: { enabled: false },
            extensions: [join(foreign, 'extensions/external.mjs')],
          })
        : 'UNTRUSTED_CONFIGURATION',
    )
  }
  const electronShim = join(root, 'electron-node-shim.cjs')
  await writeFile(electronShim, 'module.exports = {}\n')
  const fixture = {
    electronShim,
    root,
    project,
    agent,
    skills: resources ? join(resources, 'skills') : resolve('skills'),
    packagedRoot: resources ? join(resources, 'app.asar') : undefined,
    forbidden: [
      join(home, '.pi'),
      join(home, '.config'),
      join(home, '.aws'),
      join(home, '.codex'),
      foreign,
      join(project, '.pi'),
      ...files.filter((file) =>
        /^(AGENTS|SYSTEM|APPEND_SYSTEM)\.md$/.test(basename(file)),
      ),
      ...['.pi', '.config/gcloud', '.aws', '.codex/auth.json'].map((file) =>
        join(homedir(), file),
      ),
    ],
  }
  const fixturePath = join(root, 'fixture.json')
  await writeFile(fixturePath, JSON.stringify(fixture))
  const inherited = { ...process.env }
  for (const name of Object.keys(inherited)) {
    if (
      /^(PI_|OPENAI_|ANTHROPIC_|DEEPSEEK_|GOOGLE_|GEMINI_|AWS_|EXA_|TAVILY_|BRAVE_|JINA_|XAI_|GROQ_|MISTRAL_|COHERE_)/.test(
        name,
      )
    )
      delete inherited[name]
  }
  for (const poisoned of [false, true]) {
    const env = {
      ...inherited,
      ...(packagedDirectory ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
    }
    if (poisoned)
      Object.assign(env, {
        PI_CODING_AGENT_DIR: foreign,
        PI_CODING_AGENT_SESSION_DIR: foreign,
        PI_PACKAGE_DIR: foreign,
        PI_OFFLINE: '1',
        PI_CACHE_RETENTION: 'long',
        DEEPSEEK_API_KEY: 'fake-external-deepseek',
        OPENAI_API_KEY: 'fake-external-openai',
        OPENAI_ADMIN_KEY: 'fake-external-admin',
        OPENAI_BASE_URL: 'https://forbidden.invalid',
        OPENAI_ORG_ID: 'external-org',
        OPENAI_PROJECT_ID: 'external-project',
        OPENAI_CUSTOM_HEADERS: 'X-External-Configuration: forbidden',
        OPENAI_LOG: 'debug',
        GOOGLE_APPLICATION_CREDENTIALS: join(
          home,
          '.config/gcloud/application_default_credentials.json',
        ),
        AWS_SHARED_CREDENTIALS_FILE: join(home, '.aws/credentials'),
        AWS_PROFILE: 'external',
        ANTHROPIC_API_KEY: 'fake-external-anthropic',
        EXA_API_KEY: 'fake-external-exa',
        TAVILY_API_KEY: 'fake-external-tavily',
      })
    const code = await new Promise((resolveCode, reject) => {
      const child = spawn(
        executable,
        [
          resolve('scripts/agent-isolation/guard.mjs'),
          join(output, 'probe.cjs'),
          fixturePath,
        ],
        { cwd: project, env, stdio: 'inherit' },
      )
      const timer = setTimeout(() => child.kill(), 60_000)
      child.once('error', reject)
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolveCode(code)
      })
    })
    if (code !== 0)
      throw new Error(
        `Agent isolation probe failed (poisoned=${poisoned}, exit=${code})`,
      )
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
