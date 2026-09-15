// Keep the dependency policy explicit: jdeps cannot discover all service providers.
export const TIKA_JAVA_MODULES = [
  'java.base',
  'java.compiler',
  'java.desktop',
  'java.management',
  'java.naming',
  'java.net.http',
  'java.rmi',
  'java.scripting',
  'java.security.jgss',
  'java.sql',
  'java.xml.crypto',
  'jdk.unsupported',
]

export const TIKA_JAVA_PROVIDERS = [
  'jdk.charsets',
  'jdk.crypto.cryptoki',
  'jdk.crypto.ec',
  'jdk.localedata',
  'jdk.management',
  'jdk.naming.dns',
  'jdk.net',
  'jdk.nio.mapmode',
  'jdk.security.auth',
  'jdk.security.jgss',
  'jdk.zipfs',
]

export function javaMode(value = 'minimal') {
  if (!['full', 'compressed', 'minimal'].includes(value)) {
    throw new Error(`Unsupported Java runtime mode: ${value}`)
  }
  return value
}

export function imageModules(output) {
  const modules = [...output.matchAll(/^\s*Module: (\S+)\s*$/gm)]
    .map((match) => match[1])
    .sort()
  if (!modules.includes('java.base')) {
    throw new Error('jimage did not report the java.base module')
  }
  return modules
}

export function jlinkModules(mode, platform, originalModules) {
  javaMode(mode)
  const modules =
    mode === 'minimal'
      ? [
          ...TIKA_JAVA_MODULES,
          ...TIKA_JAVA_PROVIDERS,
          ...(platform === 'win32-x64' ? ['jdk.crypto.mscapi'] : []),
        ]
      : [...originalModules]
  for (const module of modules) {
    if (!originalModules.includes(module)) {
      throw new Error(
        `Required Java module is missing from ${platform}: ${module}`,
      )
    }
  }
  return modules.sort()
}

export function jlinkArguments(modulePath, modules, output) {
  return [
    '--module-path',
    modulePath,
    '--add-modules',
    modules.join(','),
    '--strip-debug',
    '--compress=zip-6',
    '--no-header-files',
    '--no-man-pages',
    '--output',
    output,
  ]
}
