import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const jdkHome = option('--jdk-home')
const tikaRoot = option('--tika-root')
if (!jdkHome || !tikaRoot) {
  throw new Error(
    'Usage: node analyze-java-modules.mjs --jdk-home <pinned JDK home> --tika-root <runtime/tika>',
  )
}
const tool = (name) =>
  join(
    resolve(jdkHome),
    'bin',
    process.platform === 'win32' ? `${name}.exe` : name,
  )
const scratch = await mkdtemp(join(tmpdir(), 'slidemind-jdeps-'))
try {
  const jars = [
    ...(await jarFiles(resolve(tikaRoot))),
    ...(await jarFiles(join(resolve(tikaRoot), 'lib'))),
  ]
  for (const jar of jars) {
    const destination = join(scratch, basename(jar, '.jar'))
    await mkdir(destination)
    await execute(tool('jar'), ['--extract', '--file', jar], {
      cwd: destination,
    })
    // Tika runs on the classpath. Module descriptors otherwise make jdeps demand
    // optional named modules (such as jakarta.mail) absent from the distribution.
    // Overlay Java 21 multi-release classes, then discard other versions.
    const versionsRoot = join(destination, 'META-INF/versions')
    let entries
    try {
      entries = await readdir(versionsRoot)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      entries = []
    }
    const versions = entries
      .filter((name) => /^\d+$/.test(name) && Number(name) <= 21)
      .sort((a, b) => Number(a) - Number(b))
    for (const version of versions) {
      await cp(join(versionsRoot, version), destination, { recursive: true })
    }
    await rm(join(destination, 'META-INF'), { recursive: true, force: true })
    await rm(join(destination, 'module-info.class'), { force: true })
  }
  const { stdout } = await execute(
    tool('jdeps'),
    [
      '--multi-release',
      '21',
      '--ignore-missing-deps',
      '--print-module-deps',
      scratch,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  )
  console.log(stdout.trim())
  console.error(
    'Static analysis only: review optional missing dependencies and retain dynamic providers separately. See docs/java-runtime-optimization.md.',
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function jarFiles(root) {
  return (await readdir(root))
    .filter((name) => name.endsWith('.jar'))
    .sort()
    .map((name) => join(root, name))
}
