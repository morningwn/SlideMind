import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBundledSkillsDirectory } from './bundled-skills'

const EXPECTED_SKILLS = [
  'data-storytelling',
  'deck-quality-review',
  'deck-strategy',
  'slide-copywriting',
  'slide-visual-design'
]

describe('resolveBundledSkillsDirectory', () => {
  it('uses the source directory during development', () => {
    expect(resolveBundledSkillsDirectory({
      appPath: '/app/slidemind',
      isPackaged: false,
      resourcesPath: '/app/resources'
    })).toBe(resolve('/app/slidemind/skills'))
  })

  it('uses Electron resources in packaged builds', () => {
    expect(resolveBundledSkillsDirectory({
      appPath: '/app/slidemind.asar',
      isPackaged: true,
      resourcesPath: '/app/resources'
    })).toBe(resolve('/app/resources/skills'))
  })
})

describe('bundled presentation skills', () => {
  it('loads every skill without diagnostics', async () => {
    const { loadSkills } = await import('@earendil-works/pi-coding-agent')
    const result = loadSkills({
      cwd: process.cwd(),
      agentDir: resolve('/tmp/slidemind-empty-agent'),
      skillPaths: [resolve('skills')],
      includeDefaults: false
    })

    expect(result.diagnostics).toEqual([])
    expect(result.skills.map((skill) => skill.name).sort()).toEqual(EXPECTED_SKILLS)
  })

  it('injects the bundled directory through the Pi resource loader', async () => {
    const { DefaultResourceLoader } = await import('@earendil-works/pi-coding-agent')
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: resolve('/tmp/slidemind-empty-agent'),
      additionalSkillPaths: [resolve('skills')],
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true
    })

    await loader.reload()

    expect(loader.getSkills().diagnostics).toEqual([])
    expect(loader.getSkills().skills.map((skill) => skill.name).sort()).toEqual(EXPECTED_SKILLS)
  })
})
