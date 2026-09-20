import { opendir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Extension,
  InlineExtension,
  ResourceLoader,
  Skill,
} from '@earendil-works/pi-coding-agent'
import { FilePolicy } from './file-policy'
import { AGENT_TOOL_NAMES, withManagedPermissions } from './managed-permissions'

export async function createManagedResources(options: {
  policy: FilePolicy
  skillsDirectory: string
  systemPrompt: string
  factories: InlineExtension[]
}): Promise<ResourceLoader> {
  // The version-pinned Pi patch exposes only the inline factory loader.
  const { createEventBus, createExtensionRuntime, loadExtensionFromFactory } =
    await import('@earendil-works/pi-coding-agent')
  const eventBus = createEventBus()
  let runtime = createExtensionRuntime()
  let extensions: Extension[] = []
  let skills: Skill[] = []
  let systemPrompt = options.systemPrompt
  const expectedOwners = new Map<string, string>()
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions, errors: [], runtime }),
    getSkills: () => ({ skills, diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
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
      // Pi's custom-prompt branch omits tool promptGuidelines. Compose the
      // trusted registered guidelines here so they survive creation and reload.
      const guidelines = new Map<string, Set<string>>()
      for (const extension of nextExtensions) {
        for (const { definition } of extension.tools.values()) {
          for (const line of definition.promptGuidelines ?? []) {
            const names = guidelines.get(line) ?? new Set<string>()
            names.add(definition.name)
            guidelines.set(line, names)
          }
        }
      }
      const nextSystemPrompt = guidelines.size
        ? `${options.systemPrompt}\n\n工具使用规则（仅在任务需要相应工具时适用，不扩大用户交付范围）：\n${[...guidelines].map(([line, names]) => `- [${[...names].join(', ')}] ${line}`).join('\n')}`
        : options.systemPrompt
      for (const [name, path] of owners) expectedOwners.set(name, path)
      extensions = nextExtensions
      runtime = nextRuntime
      skills = loadedSkills
      systemPrompt = nextSystemPrompt
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
