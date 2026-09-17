import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Exercise the installed builder's matching rules, including platform overrides.
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(
  builderRequire.resolve('app-builder-lib'),
)
const { getNodeModuleFileMatcher, getMainFileMatchers } =
  appBuilderRequire('./fileMatcher.js')
const { doMergeConfigs } = appBuilderRequire('./util/config/config.js')
const { load } = appBuilderRequire('js-yaml')
const config = doMergeConfigs([
  load(readFileSync('electron-builder.yml', 'utf8')),
])

describe('packaged dependencies', () => {
  it.each(['mac', 'win'])(
    'excludes caches and sources from %s packages',
    (key) => {
      const root = resolve('.')
      const matchers = getMainFileMatchers(
        root,
        resolve('out/release'),
        (pattern) => pattern.replaceAll('${arch}', 'x64'),
        config[key],
        {
          info: {
            config,
            projectDir: root,
            buildResourcesDir: 'assets',
            debugLogger: { isEnabled: false },
          },
          config,
          debugLogger: { isEnabled: false },
        },
        resolve('out/release'),
        false,
      )
      const filters = matchers.map((matcher) => matcher.createFilter())
      const includes = (path) =>
        filters.some((filter) =>
          filter(resolve(path), { isDirectory: () => false }),
        )
      for (const path of [
        'out/main/index.js',
        'out/main/licenses.md',
        'out/renderer/licenses.md',
        'out/preload/index.js',
        'out/renderer/assets/font.woff2',
        'package.json',
      ]) {
        expect(includes(path)).toBe(true)
      }
      for (const path of [
        'out/.tika-package-runtime/downloads/jdk.zip',
        'out/.pandoc-package-runtime/runtime/pandoc',
        '.local/probe.json',
        'src/main/index.ts',
        'out/release/previous.zip',
      ]) {
        expect(includes(path)).toBe(false)
      }
    },
  )
  it.each([
    ['mac', 'darwin', 'arm64'],
    ['mac', 'darwin', 'x64'],
    ['win', 'win32', 'x64'],
  ])(
    'keeps only target esbuild binaries for %s %s %s',
    (key, platform, arch) => {
      const root = resolve('.')
      const matcher = getNodeModuleFileMatcher(
        root,
        resolve('out/release'),
        (pattern) => pattern.replaceAll('${arch}', arch),
        config[key],
        { config, debugLogger: { isEnabled: false } },
      )
      const filter = matcher.createFilter()
      const file = { isDirectory: () => false }
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'win32-x64',
        'linux-x64',
        'aix-ppc64',
        'android-arm64',
      ]) {
        for (const name of ['package.json', 'bin/esbuild', 'esbuild.exe']) {
          expect(
            filter(
              resolve(root, `node_modules/@esbuild/${target}/${name}`),
              file,
            ),
          ).toBe(target === `${platform}-${arch}`)
        }
      }
      for (const name of [
        'esbuild/lib/main.js',
        '@earendil-works/chord/package.json',
      ]) {
        expect(filter(resolve(root, `node_modules/${name}`), file)).toBe(true)
      }
    },
  )
})
