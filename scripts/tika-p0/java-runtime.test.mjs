import { describe, expect, it } from 'vitest'
import {
  imageModules,
  javaMode,
  jlinkArguments,
  jlinkModules,
  TIKA_JAVA_MODULES,
  TIKA_JAVA_PROVIDERS,
} from './java-runtime.mjs'

const original = [
  ...TIKA_JAVA_MODULES,
  ...TIKA_JAVA_PROVIDERS,
  'jdk.jdwp.agent',
  'jdk.jfr',
  'java.instrument',
]

describe('Java runtime policy', () => {
  it('rejects unknown modes instead of silently changing the build', () => {
    expect(javaMode()).toBe('minimal')
    expect(javaMode('full')).toBe('full')
    expect(() => javaMode('minmal')).toThrow('Unsupported Java runtime mode')
  })

  it('preserves every source module in the compression control', () => {
    expect(jlinkModules('compressed', 'darwin-arm64', original)).toEqual(
      [...original].sort(),
    )
  })

  it('retains dynamic providers while dropping instrumentation and debugging', () => {
    const modules = jlinkModules('minimal', 'darwin-arm64', original)
    expect(modules).toEqual(
      expect.arrayContaining([
        'java.desktop',
        'jdk.charsets',
        'jdk.localedata',
        'jdk.crypto.ec',
        'jdk.crypto.cryptoki',
        'jdk.zipfs',
        'jdk.unsupported',
      ]),
    )
    expect(modules).not.toContain('jdk.jdwp.agent')
    expect(modules).not.toContain('java.instrument')
    expect(modules).not.toContain('jdk.jfr')
  })

  it('retains the Windows native crypto provider only for Windows', () => {
    expect(
      jlinkModules('minimal', 'win32-x64', [...original, 'jdk.crypto.mscapi']),
    ).toContain('jdk.crypto.mscapi')
    expect(jlinkModules('minimal', 'darwin-x64', original)).not.toContain(
      'jdk.crypto.mscapi',
    )
    expect(() => jlinkModules('minimal', 'win32-x64', original)).toThrow(
      'jdk.crypto.mscapi',
    )
  })

  it('fails when the upstream image no longer contains a required dependency', () => {
    expect(() =>
      jlinkModules(
        'minimal',
        'darwin-arm64',
        original.filter((name) => name !== 'java.desktop'),
      ),
    ).toThrow('java.desktop')
  })

  it('reads actual image modules instead of stale JRE release metadata', () => {
    expect(
      imageModules(
        'jimage: /tmp/java/lib/modules\n\nModule: java.base\n  java/lang/Object.class\nModule: java.desktop\n  java/awt/Font.class\n',
      ),
    ).toEqual(['java.base', 'java.desktop'])
    expect(() => imageModules('MODULES="java.base java.desktop"')).toThrow(
      'java.base',
    )
  })

  it('passes paths containing spaces as single arguments and keeps locale data', () => {
    const args = jlinkArguments(
      '/tmp/JDK 中文/jmods',
      ['java.base', 'jdk.localedata'],
      '/tmp/output path',
    )
    expect(args[args.indexOf('--module-path') + 1]).toBe('/tmp/JDK 中文/jmods')
    expect(args[args.indexOf('--output') + 1]).toBe('/tmp/output path')
    expect(args).toContain('--compress=zip-6')
    expect(args).not.toContain('--include-locales')
    expect(args).not.toContain('--bind-services')
  })
})
