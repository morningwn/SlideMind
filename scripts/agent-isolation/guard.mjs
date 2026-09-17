import fs from 'node:fs'
import promises from 'node:fs/promises'
import net from 'node:net'
import childProcess from 'node:child_process'
import {
  createRequire,
  registerHooks,
  syncBuiltinESMExports,
} from 'node:module'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [entry, fixturePath] = process.argv.slice(2)
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const packagedRequire = fixture.packagedRoot
  ? createRequire(resolve(fixture.packagedRoot, 'package.json'))
  : undefined
const forbidden = fixture.forbidden.map((path) => resolve(path))
const attempts = []
const packagedImports = new Set()
let phase = 'module-import'
function check(value, operation) {
  if (value instanceof URL) value = fileURLToPath(value)
  if (Buffer.isBuffer(value)) value = value.toString()
  if (typeof value !== 'string') return
  const path = resolve(value)
  if (
    forbidden.some((root) => {
      const child = relative(root, path)
      return (
        child === '' ||
        (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
      )
    })
  ) {
    attempts.push({ phase, operation, path })
    throw Object.assign(
      new Error(`Forbidden configuration access: ${operation} ${path}`),
      { code: 'EACCES' },
    )
  }
}
for (const [api, names] of [
  [
    fs,
    [
      'access',
      'accessSync',
      'existsSync',
      'open',
      'openSync',
      'readFile',
      'readFileSync',
      'readdir',
      'readdirSync',
      'opendir',
      'opendirSync',
      'stat',
      'statSync',
      'lstat',
      'lstatSync',
      'realpath',
      'realpathSync',
      'readlink',
      'readlinkSync',
      'createReadStream',
      'watch',
      'watchFile',
    ],
  ],
  [
    promises,
    [
      'access',
      'open',
      'readFile',
      'readdir',
      'opendir',
      'stat',
      'lstat',
      'realpath',
      'readlink',
      'watch',
    ],
  ],
]) {
  for (const name of names) {
    const original = api[name]
    const wrapped = function (path, ...args) {
      check(path, name)
      return original.call(this, path, ...args)
    }
    Object.assign(wrapped, original)
    if (original.native)
      wrapped.native = (path, ...args) => {
        check(path, `${name}.native`)
        return original.native(path, ...args)
      }
    api[name] = wrapped
  }
}
net.Socket.prototype.connect = function () {
  attempts.push({ phase, operation: 'network.connect' })
  throw new Error('Unexpected network connection in offline isolation probe')
}
for (const name of [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
]) {
  childProcess[name] = () => {
    attempts.push({ phase, operation: `child_process.${name}` })
    throw new Error('Unexpected external command in isolation probe')
  }
}
syncBuiltinESMExports()
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Node mode has no Electron builtin; only the unused logger IPC adapter needs it.
    if (fixture.packagedRoot && specifier === 'electron')
      return nextResolve(fixture.electronShim, context)
    if (specifier.startsWith('file:'))
      check(new URL(specifier), 'module.resolve')
    else if (isAbsolute(specifier)) check(specifier, 'module.resolve')
    const bare =
      !specifier.startsWith('.') &&
      !isAbsolute(specifier) &&
      !specifier.includes(':')
    const packagedImport =
      fixture.packagedRoot &&
      bare &&
      context.parentURL === pathToFileURL(entry).href
    const resolvedSpecifier =
      packagedImport && context.conditions.includes('require')
        ? packagedRequire.resolve(specifier)
        : specifier
    const result = nextResolve(
      resolvedSpecifier,
      packagedImport
        ? {
            ...context,
            parentURL: pathToFileURL(
              resolve(fixture.packagedRoot, 'package.json'),
            ).href,
          }
        : context,
    )
    if (result.url.startsWith('file:')) {
      check(new URL(result.url), 'module.resolve')
      if (packagedImport) {
        const child = relative(fixture.packagedRoot, fileURLToPath(result.url))
        if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`))
          throw new Error(
            `Dependency escaped the packaged application: ${specifier}`,
          )
        packagedImports.add(specifier)
      }
    }
    return result
  },
})
// Verify the observer before relying on a zero-access result.
try {
  fs.readFileSync(forbidden[0])
} catch {
  /* Expected probe denial. */
}
if (attempts.length !== 1) throw new Error('File observer self-test failed')
attempts.length = 0
const { verify } = await import(pathToFileURL(entry).href)
try {
  const result = await verify(fixture, (value) => {
    phase = value
  })
  if (attempts.length) throw new Error(JSON.stringify(attempts))
  if (
    fixture.packagedRoot &&
    !packagedImports.has('@earendil-works/pi-coding-agent')
  )
    throw new Error('Packaged SDK resolution was not exercised')
  console.log(
    JSON.stringify({
      ...result,
      platform: process.platform,
      arch: process.arch,
      forbiddenAccesses: attempts.length,
      packagedDependencies: packagedImports.size,
    }),
  )
} catch (error) {
  console.error(error)
  if (attempts.length) console.error(JSON.stringify(attempts))
  process.exitCode = 1
}
