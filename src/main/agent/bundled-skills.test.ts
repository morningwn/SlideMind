import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBundledSkillsDirectory } from './bundled-skills'
import { queryTemplate } from './template-query'
import { FilePolicy } from './file-policy'
import { loadManagedSkills } from './managed-resources'

const EXPECTED_SKILLS = [
  'data-storytelling',
  'deck-quality-review',
  'deck-strategy',
  'ppt-production-workflow',
  'pptist-template-library',
  'slide-copywriting',
  'slide-flowchart',
  'slide-visual-design',
  'task-workflow',
]

const EXPECTED_TEMPLATE_SLIDE_COUNTS = [38, 36, 36, 36, 27, 28, 26, 30]
async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name)
        return entry.isDirectory() ? listFiles(path) : [path]
      }),
    )
  ).flat()
}

describe('resolveBundledSkillsDirectory', () => {
  it('uses the source directory during development', () => {
    const appPath = resolve('fixtures', 'slidemind')
    expect(
      resolveBundledSkillsDirectory({
        appPath,
        isPackaged: false,
        resourcesPath: resolve('fixtures', 'resources'),
      }),
    ).toBe(resolve(appPath, 'skills'))
  })

  it('uses Electron resources in packaged builds', () => {
    const resourcesPath = resolve('fixtures', 'resources')
    expect(
      resolveBundledSkillsDirectory({
        appPath: resolve('fixtures', 'slidemind.asar'),
        isPackaged: true,
        resourcesPath,
      }),
    ).toBe(resolve(resourcesPath, 'skills'))
  })
})

describe('bundled authoring skills', () => {
  it('loads the application catalog from validated bundled files only', async () => {
    const root = resolve('skills')
    const policy = await FilePolicy.create(process.cwd(), [root])
    const skills = await loadManagedSkills(root, policy)
    expect(skills.map((skill) => skill.name).sort()).toEqual(
      [...EXPECTED_SKILLS].sort(),
    )
    for (const skill of skills)
      await expect(policy.resolve(skill.filePath, 'write')).rejects.toThrow(
        '只允许读取',
      )
  })

  it('keeps web evidence distinct from automatic fact judgments', async () => {
    const workflow = await readFile(
      resolve('skills/ppt-production-workflow/SKILL.md'),
      'utf8',
    )
    expect(workflow).toContain('search_excerpt')
    expect(workflow).toContain('get_search_content')
    expect(workflow).toContain('只组织证据，不提供真假判定')
  })

  it('loads every skill without diagnostics', async () => {
    const { loadSkills } = await import('@earendil-works/pi-coding-agent')
    const result = loadSkills({
      cwd: process.cwd(),
      agentDir: resolve(tmpdir(), 'slidemind-empty-agent'),
      skillPaths: [resolve('skills')],
      includeDefaults: false,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.skills.map((skill) => skill.name).sort()).toEqual(
      EXPECTED_SKILLS,
    )
  })

  it('declares non-overlapping discovery boundaries for full-deck and specialist work', async () => {
    const { loadSkills } = await import('@earendil-works/pi-coding-agent')
    const { skills } = loadSkills({
      cwd: process.cwd(),
      agentDir: resolve(tmpdir(), 'slidemind-empty-agent'),
      skillPaths: [resolve('skills')],
      includeDefaults: false,
    })
    const descriptions = new Map(
      skills.map((skill) => [skill.name, skill.description]),
    )

    expect(descriptions.get('ppt-production-workflow')).toContain('整份 PPT')
    expect(descriptions.get('task-workflow')).toContain(
      '简单问答和局部润色无需',
    )
    expect(descriptions.get('pptist-template-library')).toContain(
      '不独立负责整份 PPT',
    )
    expect(descriptions.get('slide-visual-design')).toContain(
      '不独立负责整份 PPT',
    )
    expect(descriptions.get('deck-quality-review')).toContain(
      '全面重写应使用总控制作流程',
    )
  })

  it('keeps workflow state and image-source guidance aligned with application capabilities', async () => {
    const workflow = await readFile(
      resolve('skills/ppt-production-workflow/SKILL.md'),
      'utf8',
    )
    const contract = await readFile(
      resolve(
        'skills/ppt-production-workflow/references/production-contract.md',
      ),
      'utf8',
    )
    const imageGuides = await Promise.all(
      [
        'skills/data-storytelling/SKILL.md',
        'skills/slide-visual-design/SKILL.md',
        'skills/pptist-template-library/references/slidemind-mapping.md',
      ].map((file) => readFile(resolve(file), 'utf8')),
    )
    const taskWorkflow = await readFile(
      resolve('skills/task-workflow/SKILL.md'),
      'utf8',
    )

    expect(workflow).toContain('连续模式')
    expect(workflow).toContain('审阅模式')
    expect(contract).toContain('`continuous`')
    expect(contract).toContain('`review`')
    expect(contract).toContain('`document_read`')
    expect(contract).toContain('`nextCursor`')
    expect(taskWorkflow).toContain('`task-status.md`')
    expect(taskWorkflow).toContain('`workflow-status.md`')
    expect(taskWorkflow).toContain('不再为同一演示维护重复的')
    expect(workflow).toContain('`task-workflow`')
    expect(workflow).not.toMatch(/\.\.\/[^\s`]+\/SKILL\.md/)
    for (const guide of imageGuides) {
      expect(guide).toContain('项目内图片')
      expect(guide).toContain('data:image/...')
      expect(guide).not.toContain('只允许 `data:image/...`')
    }
  })

  it('injects the bundled directory through the Pi resource loader', async () => {
    const { DefaultResourceLoader } = await import(
      '@earendil-works/pi-coding-agent'
    )
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: resolve(tmpdir(), 'slidemind-empty-agent'),
      additionalSkillPaths: [resolve('skills')],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    })

    await loader.reload()

    expect(loader.getSkills().diagnostics).toEqual([])
    expect(
      loader
        .getSkills()
        .skills.map((skill) => skill.name)
        .sort(),
    ).toEqual(EXPECTED_SKILLS)
  })

  it('bundles every PPTist template as a readable skill asset', async () => {
    const templates = await Promise.all(
      EXPECTED_TEMPLATE_SLIDE_COUNTS.map(async (_, index) => {
        const content = await readFile(
          resolve(
            `skills/pptist-template-library/assets/template_${index + 1}.json`,
          ),
          'utf8',
        )
        return JSON.parse(content) as {
          slides: Array<{ type?: string }>
          theme: { themeColors: string[] }
        }
      }),
    )

    expect(templates.map((template) => template.slides.length)).toEqual(
      EXPECTED_TEMPLATE_SLIDE_COUNTS,
    )
    for (const template of templates) {
      expect(template.theme.themeColors.length).toBeGreaterThan(0)
      expect(new Set(template.slides.map((slide) => slide.type))).toEqual(
        new Set(['cover', 'contents', 'transition', 'content', 'end']),
      )
    }
  })

  it('keeps bundled template assets offline', async () => {
    const files = await listFiles(
      resolve('skills/pptist-template-library/assets'),
    )
    const contents = await Promise.all(
      files.map((file) => readFile(file, 'utf8')),
    )

    expect(contents.some((content) => /https?:\/\//i.test(content))).toBe(false)
  })

  it('queries one template through the application tool implementation', async () => {
    const result = await queryTemplate(resolve('skills'), {
      action: 'slides',
      templateId: 'template_2',
      pageType: 'content',
    })

    expect(result.templateId).toBe('template_2')
    const slides = 'slides' in result ? result.slides : undefined
    expect(slides).toBeDefined()
    if (!slides) throw new Error('模板查询未返回页面摘要')
    expect(slides).toHaveLength(11)
    expect(slides.some((slide) => slide.textRoles.item === 4)).toBe(true)
  })
})
