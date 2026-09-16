import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendProjectContext,
  createCacheOptimizationExtension,
} from './cache-optimization'

describe('appendProjectContext', () => {
  it('preserves the full Skill list before project-specific context', () => {
    const sharedPrompt =
      'SlideMind instructions\n\n<available_skills>full descriptions</available_skills>\nCurrent working directory: /project-a'
    const result = appendProjectContext(sharedPrompt, '/project-a')

    expect(result).toBe(
      `${sharedPrompt}\n\n当前对话所属项目目录（JSON 字符串）："/project-a"`,
    )
    expect(appendProjectContext(result, '/project-a')).toBe(result)
  })

  it('keeps the common prefix identical when projects have the same Skill list', () => {
    const sharedPrompt =
      'SlideMind instructions\n\n<available_skills>full descriptions</available_skills>'
    const first = appendProjectContext(sharedPrompt, '/project-a')
    const second = appendProjectContext(sharedPrompt, '/project-b')

    expect(first.startsWith(sharedPrompt)).toBe(true)
    expect(second.startsWith(sharedPrompt)).toBe(true)
    expect(first).not.toBe(second)
  })

  it('places project context after skills in Pi assembled prompts and retains its factory on reload', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-cache-prompt-'))
    const skillPath = join(projectPath, 'skills', 'cache-check')
    const agentDirectory = join(projectPath, 'agent')
    await mkdir(skillPath, { recursive: true })
    await writeFile(
      join(skillPath, 'SKILL.md'),
      '---\nname: cache-check\ndescription: Verify cache prompt placement\n---\nInstructions\n',
    )
    const {
      createAgentSession,
      DefaultResourceLoader,
      ModelRuntime,
      SessionManager,
    } = await import('@earendil-works/pi-coding-agent')
    const loader = new DefaultResourceLoader({
      cwd: projectPath,
      agentDir: agentDirectory,
      additionalSkillPaths: [skillPath],
      extensionFactories: [
        {
          name: 'cache-optimization',
          factory: createCacheOptimizationExtension(projectPath),
        },
      ],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: 'Shared instructions',
    })
    await loader.reload()
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDirectory, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false,
    })
    const model = modelRuntime.getModels()[0]
    expect(model).toBeDefined()
    const { session } = await createAgentSession({
      cwd: projectPath,
      agentDir: agentDirectory,
      modelRuntime,
      model: model!,
      tools: ['read'],
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(projectPath),
    })

    try {
      const basePrompt = session.agent.state.systemPrompt
      expect(basePrompt).toContain('<available_skills>')
      expect(basePrompt).toContain('Verify cache prompt placement')
      const initial = await session.extensionRunner.emitBeforeAgentStart(
        'test',
        undefined,
        basePrompt,
        { cwd: projectPath },
      )
      const context = `当前对话所属项目目录（JSON 字符串）：${JSON.stringify(projectPath)}`
      expect(initial?.systemPrompt?.indexOf('<available_skills>')).toBeLessThan(
        initial!.systemPrompt!.indexOf(context),
      )

      await loader.reload()
      expect(loader.getExtensions().extensions).toHaveLength(1)
    } finally {
      session.dispose()
      await rm(projectPath, { recursive: true, force: true })
    }
  })
})
