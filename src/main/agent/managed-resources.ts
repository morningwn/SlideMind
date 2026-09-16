import { opendir } from 'node:fs/promises'
import { findPackageJSON } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  EventBus,
  Extension,
  ExtensionFactory,
  ExtensionRuntime,
  InlineExtension,
  ResourceLoader,
  Skill,
} from '@earendil-works/pi-coding-agent'
import { FilePolicy } from './file-policy'
import { AGENT_TOOL_NAMES, withManagedPermissions } from './managed-permissions'

type FactoryLoader = (
  factory: ExtensionFactory,
  cwd: string,
  bus: EventBus,
  runtime: ExtensionRuntime,
  path: string,
) => Promise<Extension>

export async function createManagedResources(options: {
  policy: FilePolicy
  skillsDirectory: string
  systemPrompt: string
  factories: InlineExtension[]
}): Promise<ResourceLoader> {
  const { createEventBus, createExtensionRuntime } = await import(
    '@earendil-works/pi-coding-agent'
  )
  // Pi 0.85.1 exposes the factory loader internally but not from its root export.
  // Keep this single version-pinned adapter under integration tests; never invoke discovery.
  const packagePath = findPackageJSON(
    '@earendil-works/pi-coding-agent',
    import.meta.url,
  )
  if (!packagePath) throw new Error('Pi SDK package is missing')
  const loaderPath = join(
    dirname(packagePath),
    'dist/core/extensions/loader.js',
  )
  const { loadExtensionFromFactory } = (await import(
    pathToFileURL(loaderPath).href
  )) as { loadExtensionFromFactory: FactoryLoader }
  const eventBus = createEventBus()
  let runtime = createExtensionRuntime()
  let extensions: Extension[] = []
  let skills: Skill[] = []
  const expectedOwners = new Map<string, string>()
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions, errors: [], runtime }),
    getSkills: () => ({ skills, diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => options.systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: (paths) => {
      if (Object.values(paths).some((value) => value?.length))
        throw new Error('不允许扩展发现外部资源')
    },
    reload: async () => {
      const nextRuntime = createExtensionRuntime()
      const nextExtensions: Extension[] = []
      const owners = new Map<string, string>()
      for (const [index, input] of options.factories.entries()) {
        const factory = typeof input === 'function' ? input : input.factory
        const path = `<inline:${typeof input === 'function' ? index : input.name}>`
        const extension = await loadExtensionFromFactory(
          withManagedPermissions(factory, options.policy),
          options.policy.projectRoot,
          eventBus,
          nextRuntime,
          path,
        )
        for (const name of extension.tools.keys()) {
          if (owners.has(name)) throw new Error(`工具重复注册：${name}`)
          if (expectedOwners.size && expectedOwners.get(name) !== path)
            throw new Error(`工具来源发生变化：${name}`)
          owners.set(name, path)
        }
        nextExtensions.push(extension)
      }
      if (
        owners.size !== AGENT_TOOL_NAMES.length ||
        AGENT_TOOL_NAMES.some((name) => !owners.has(name))
      )
        throw new Error('Agent 工具注册表与白名单不一致')
      const loadedSkills = await loadManagedSkills(
        options.skillsDirectory,
        options.policy,
      )
      for (const [name, path] of owners) expectedOwners.set(name, path)
      extensions = nextExtensions
      runtime = nextRuntime
      skills = loadedSkills
    },
  }
  return resourceLoader
}

export async function loadManagedSkills(
  directory: string,
  policy: FilePolicy,
): Promise<Skill[]> {
  const { loadSkills } = await import('@earendil-works/pi-coding-agent')
  const paths: string[] = []
  const add = async (path: string) => {
    try {
      paths.push(await policy.resolve(path, 'read'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const root = await policy.resolve(directory, 'read', 'directory')
  await add(join(root, 'SKILL.md'))
  if (!paths.length) {
    let scanned = 0
    for await (const entry of await opendir(root)) {
      if (++scanned > 1000) throw new Error('Too many bundled skill entries')
      if (entry.isSymbolicLink())
        throw new Error('Bundled skills cannot contain symlinks')
      if (entry.isDirectory() && !entry.name.startsWith('.'))
        await add(join(root, entry.name, 'SKILL.md'))
    }
  }
  const result = loadSkills({
    cwd: policy.projectRoot,
    agentDir: root,
    skillPaths: paths,
    includeDefaults: false,
  })
  if (result.diagnostics.length)
    throw new Error('Bundled skill validation failed')
  return result.skills
}
