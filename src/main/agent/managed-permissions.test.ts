import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ExtensionFactory,
  ResourceLoader,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilePolicy } from './file-policy'
import {
  AGENT_TOOL_NAMES,
  authorizeAgentTool,
  createPermissionGuard,
} from './managed-permissions'
import { createManagedResources } from './managed-resources'
import { createFileSearchTools } from './file-search-tools'
import { createProjectMutationToolsExtension } from './project-mutation-tools'
import type { ProjectMutationService } from '../version-control/project-mutation-service'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function setup(extra?: ExtensionFactory) {
  const dir = await mkdtemp(join(tmpdir(), 'slidemind-permissions-'))
  directories.push(dir)
  const project = join(dir, 'project')
  const skills = join(dir, 'skills')
  await mkdir(project)
  await mkdir(skills)
  await writeFile(
    join(skills, 'SKILL.md'),
    '---\nname: internal\ndescription: Internal test skill\n---\nOnly internal instructions',
  )
  const policy = await FilePolicy.create(project, [skills])
  const mutated: string[][] = []
  const mutations = {
    run: async (
      input: { paths: string[] },
      operation: () => Promise<unknown>,
    ) => {
      mutated.push(input.paths)
      return operation()
    },
  } as unknown as ProjectMutationService
  // Non-file service doubles allow asserting that unauthorized paths never reach I/O.
  const calls = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'ok' }],
    details: {},
  }))
  const services: ExtensionFactory = async (pi) => {
    const { Type } = await import('@earendil-works/pi-ai')
    for (const name of AGENT_TOOL_NAMES.filter(
      (name) =>
        ![
          'read',
          'write',
          'edit',
          'grep',
          'find',
          'ls',
          'download_asset',
        ].includes(name),
    )) {
      pi.registerTool({
        name,
        label: name,
        description: name,
        promptGuidelines:
          name === 'document_read' || name === 'pptx_read'
            ? ['Keep source provenance when reading documents.']
            : undefined,
        parameters: Type.Object({}),
        execute: calls,
      })
    }
  }
  const loader = await createManagedResources({
    policy,
    skillsDirectory: skills,
    systemPrompt: 'App controlled prompt',
    factories: [
      {
        name: 'files',
        factory: createProjectMutationToolsExtension({
          projectPath: project,
          projectHandle: 'project',
          filePolicy: policy,
          mutations,
        }),
      },
      { name: 'search', factory: createFileSearchTools(policy) },
      { name: 'services', factory: services },
      { name: 'guard', factory: createPermissionGuard },
      ...(extra ? [{ name: 'unexpected', factory: extra }] : []),
    ],
  })
  return { dir, project, skills, policy, loader, calls, mutated }
}

function tool(loader: ResourceLoader, name: string): ToolDefinition {
  return loader
    .getExtensions()
    .extensions.flatMap((extension) => [...extension.tools.values()])
    .find((tool) => tool.definition.name === name)!.definition
}
function run(
  loader: ResourceLoader,
  name: string,
  params: Record<string, unknown>,
  signal = new AbortController().signal,
) {
  return tool(loader, name).execute(
    'test',
    params,
    signal,
    undefined,
    {} as never,
  )
}

describe('managed permission execution', () => {
  it('keeps legitimate file reads, edits, writes, images and mutation callbacks', async () => {
    const { project, loader, mutated } = await setup()
    await loader.reload()
    await run(loader, 'write', {
      path: 'nested/a.txt',
      content: 'alpha\nbeta\ngamma',
    })
    const read = await run(loader, 'read', {
      path: 'nested/a.txt',
      offset: 2,
      limit: 1,
    })
    expect(JSON.stringify(read)).toContain('beta')
    await run(loader, 'edit', {
      path: 'nested/a.txt',
      edits: [{ oldText: 'beta', newText: 'changed' }],
    })
    expect(await readFile(join(project, 'nested/a.txt'), 'utf8')).toContain(
      'changed',
    )
    expect(mutated).toHaveLength(2)
    await writeFile(
      join(project, 'image.gif'),
      Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64',
      ),
    )
    expect(
      (await run(loader, 'read', { path: 'image.gif' })).content.some(
        (block) => block.type === 'image',
      ),
    ).toBe(true)
  })

  it('rejects traversal, symlinks, secrets, protected trees and read-only writes in actual tools', async () => {
    const { dir, project, skills, loader, mutated } = await setup()
    await writeFile(join(dir, 'outside.txt'), 'outside secret')
    await symlink(join(dir, 'outside.txt'), join(project, 'escape.txt'))
    await symlink(skills, join(project, 'linked'))
    await symlink(join(project, 'missing'), join(project, 'dangling'))
    await mkdir(join(project, '.git'))
    await writeFile(join(project, '.git', 'secret'), 'private')
    await writeFile(join(project, '.env'), 'private')
    await loader.reload()
    for (const path of [
      '../outside.txt',
      join(dir, 'outside.txt'),
      'escape.txt',
      'dangling',
      '.env',
      '.git/secret',
    ]) {
      await expect(run(loader, 'read', { path })).rejects.toThrow()
      await expect(
        run(loader, 'write', { path, content: 'modified' }),
      ).rejects.toThrow()
      await expect(
        run(loader, 'edit', {
          path,
          edits: [{ oldText: 'private', newText: 'modified' }],
        }),
      ).rejects.toThrow()
    }
    await expect(
      run(loader, 'write', { path: 'linked/new.txt', content: 'bad' }),
    ).rejects.toThrow('符号链接')
    await expect(
      run(loader, 'write', { path: join(skills, 'SKILL.md'), content: 'bad' }),
    ).rejects.toThrow('只允许读取')
    await expect(
      run(loader, 'write', { path: '.pi/settings.json', content: '{}' }),
    ).rejects.toThrow('受保护')
    expect(
      JSON.stringify(
        await run(loader, 'read', { path: join(skills, 'SKILL.md') }),
      ),
    ).toContain('Only internal')
    expect(mutated).toEqual([])
    expect(await readFile(join(dir, 'outside.txt'), 'utf8')).toBe(
      'outside secret',
    )
  })

  it('searches with default project roots, globs, regex and context without leaking protected content', async () => {
    const { project, loader } = await setup()
    await writeFile(join(project, 'brief.md'), 'before\nEvidence\nafter')
    await writeFile(join(project, '.env'), 'Evidence secret')
    await mkdir(join(project, 'node_modules'))
    await writeFile(
      join(project, 'node_modules', 'hidden.md'),
      'Evidence secret',
    )
    await loader.reload()
    expect(
      JSON.stringify(
        await run(loader, 'grep', {
          pattern: 'evidence',
          ignoreCase: true,
          glob: '*.md',
          context: 1,
        }),
      ),
    ).toContain('before')
    for (const name of ['find', 'ls', 'grep']) {
      const result = await run(
        loader,
        name,
        name === 'ls' ? {} : { pattern: name === 'find' ? '**/*' : 'Evidence' },
      )
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(JSON.stringify(result)).not.toContain('.env')
      expect(JSON.stringify(result)).not.toContain('hidden.md')
    }
    await expect(run(loader, 'grep', { pattern: '[invalid' })).rejects.toThrow(
      '无效',
    )
    await writeFile(join(project, 'evil.txt'), 'a'.repeat(20000) + '!')
    await expect(
      run(loader, 'grep', { pattern: '(a+)+$', glob: 'evil.txt' }),
    ).rejects.toThrow('超时')
    await expect(
      run(loader, 'find', { pattern: '*' }, AbortSignal.abort()),
    ).rejects.toThrow()
  })

  it('blocks custom service paths and nested image/output paths before execution', async () => {
    const { project, loader, calls } = await setup()
    await writeFile(join(project, 'deck.slides.json'), '{}')
    await loader.reload()
    for (const name of [
      'document_read',
      'pptx_read',
      'slides_read',
      'slides_render',
      'slides_review',
      'slides_create',
      'slides_write',
    ]) {
      await expect(run(loader, name, { file: '../outside' })).rejects.toThrow()
    }
    await expect(
      run(loader, 'slides_export', {
        file: 'deck.slides.json',
        output: '../outside.pptx',
      }),
    ).rejects.toThrow()
    await expect(
      run(loader, 'slides_write', {
        file: 'deck.slides.json',
        slides: [{ elements: [{ type: 'image', source: '../secret.png' }] }],
      }),
    ).rejects.toThrow()
    await expect(
      run(loader, 'download_asset', {
        path: '.env',
        url: 'https://example.com',
        kind: 'text',
      }),
    ).rejects.toThrow()
    expect(calls).not.toHaveBeenCalled()
  })

  it('does not load project/user settings, skills or prompts, including on reload', async () => {
    const { dir, project, loader } = await setup()
    await mkdir(join(project, '.pi'), { recursive: true })
    await writeFile(
      join(project, '.pi', 'settings.json'),
      '{"extensions":["evil"],"compaction":{"enabled":false}}',
    )
    await writeFile(join(project, 'AGENTS.md'), 'UNTRUSTED_MARKER')
    await writeFile(
      join(project, '.pi', 'APPEND_SYSTEM.md'),
      'UNTRUSTED_MARKER',
    )
    vi.stubEnv('PI_CODING_AGENT_DIR', dir)
    await loader.reload()
    await loader.reload()
    expect(loader.getAgentsFiles().agentsFiles).toEqual([])
    expect(loader.getAppendSystemPrompt()).toEqual([])
    expect(loader.getSystemPrompt()).toMatch(/^App controlled prompt/)
    expect(loader.getSystemPrompt()).not.toContain('UNTRUSTED_MARKER')
    expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual([
      'internal',
    ])
    expect(
      loader
        .getExtensions()
        .extensions.flatMap((ext) => [...ext.tools.keys()])
        .sort(),
    ).toEqual([...AGENT_TOOL_NAMES].sort())
    const settings = (
      await import('@earendil-works/pi-coding-agent')
    ).SettingsManager.inMemory({ compaction: { enabled: true } })
    await settings.reload()
    expect(settings.getCompactionSettings().enabled).toBe(true)
  })

  it('rejects unknown tools and same-name overrides at registration', async () => {
    for (const name of ['bash', 'read']) {
      const { loader } = await setup(async (pi) => {
        const { Type } = await import('@earendil-works/pi-ai')
        pi.registerTool({
          name,
          label: name,
          description: name,
          parameters: Type.Object({}),
          execute: async () => ({ content: [], details: {} }),
        })
      })
      await expect(loader.reload()).rejects.toThrow()
    }
    const { policy } = await setup()
    await expect(authorizeAgentTool(policy, 'unknown', {})).rejects.toThrow(
      '未授权',
    )
  })

  it('keeps a real Pi session restricted after reload and restores controlled settings', async () => {
    const { project, loader, dir } = await setup()
    await loader.reload()
    const {
      createAgentSession,
      ModelRuntime,
      SessionManager,
      SettingsManager,
    } = await import('@earendil-works/pi-coding-agent')
    const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai')
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    })
    const settings = SettingsManager.inMemory({ compaction: { enabled: true } })
    const { session } = await createAgentSession({
      cwd: project,
      agentDir: dir,
      modelRuntime: runtime,
      model: runtime.getModels()[0],
      sessionManager: SessionManager.inMemory(project),
      settingsManager: settings,
      resourceLoader: loader,
      tools: [...AGENT_TOOL_NAMES],
    })
    try {
      for (let i = 0; i < 2; i++) {
        const prompt = session.agent.state.systemPrompt
        const guidelines = new Set(
          loader
            .getExtensions()
            .extensions.flatMap((extension) =>
              [...extension.tools.values()].flatMap(
                (tool) => tool.definition.promptGuidelines ?? [],
              ),
            ),
        )
        expect(guidelines.size).toBeGreaterThan(0)
        for (const guideline of guidelines) {
          expect(prompt.split(guideline)).toHaveLength(2)
          expect(prompt.indexOf(guideline)).toBeLessThan(
            prompt.indexOf('<available_skills>'),
          )
        }
        expect(session.getActiveToolNames().sort()).toEqual(
          [...AGENT_TOOL_NAMES].sort(),
        )
        expect(
          session
            .getAllTools()
            .map((tool) => tool.name)
            .sort(),
        ).toEqual([...AGENT_TOOL_NAMES].sort())
        expect(
          session
            .getAllTools()
            .every((tool) => tool.sourceInfo.path.startsWith('<inline:')),
        ).toBe(true)
        expect(
          (
            await session.extensionRunner.emitToolCall({
              type: 'tool_call',
              toolName: 'bash',
              toolCallId: 'blocked',
              input: { command: 'echo forbidden' },
            })
          )?.block,
        ).toBe(true)
        await session.reload()
        expect(settings.getCompactionSettings().enabled).toBe(true)
      }
    } finally {
      session.dispose()
    }
  })
})
