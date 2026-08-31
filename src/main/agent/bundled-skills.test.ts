import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { resolveBundledSkillsDirectory } from './bundled-skills'

const EXPECTED_SKILLS = [
  'data-storytelling',
  'deck-quality-review',
  'deck-strategy',
  'pptist-template-library',
  'slide-copywriting',
  'slide-visual-design'
]

const EXPECTED_TEMPLATE_SLIDE_COUNTS = [38, 36, 36, 36, 27, 28, 26, 30]
const execFileAsync = promisify(execFile)

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

  it('bundles every PPTist template as a readable skill asset', async () => {
    const templates = await Promise.all(EXPECTED_TEMPLATE_SLIDE_COUNTS.map(async (_, index) => {
      const content = await readFile(
        resolve(`skills/pptist-template-library/assets/template_${index + 1}.json`),
        'utf8'
      )
      return JSON.parse(content) as {
        slides: Array<{ type?: string }>
        theme: { themeColors: string[] }
      }
    }))

    expect(templates.map((template) => template.slides.length)).toEqual(
      EXPECTED_TEMPLATE_SLIDE_COUNTS
    )
    for (const template of templates) {
      expect(template.theme.themeColors.length).toBeGreaterThan(0)
      expect(new Set(template.slides.map((slide) => slide.type))).toEqual(
        new Set(['cover', 'contents', 'transition', 'content', 'end'])
      )
    }
  })

  it('queries one template without loading the complete library', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      resolve('skills/pptist-template-library/scripts/query-template.mjs'),
      'slides',
      'template_2',
      'content'
    ])
    const result = JSON.parse(stdout) as {
      slides: Array<{ index: number; textRoles: Record<string, number>; type: string }>
      templateId: string
    }

    expect(result.templateId).toBe('template_2')
    expect(result.slides).toHaveLength(11)
    expect(result.slides.every((slide) => slide.type === 'content')).toBe(true)
    expect(result.slides.some((slide) => slide.textRoles.item === 4)).toBe(true)
  })
})
