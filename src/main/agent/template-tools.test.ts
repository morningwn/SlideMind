import { describe, expect, it } from 'vitest'
import { createTemplateToolsExtension } from './template-tools'

describe('createTemplateToolsExtension', () => {
  it('registers an object-shaped function schema', async () => {
    let parameters: unknown
    const extension = createTemplateToolsExtension({
      bundledSkillsDirectory: '/app/skills',
    })

    await extension({
      registerTool(tool: { parameters: unknown }) {
        parameters = tool.parameters
      },
    } as never)

    expect(parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
    })
  })
})
