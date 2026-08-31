import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import {
  TEMPLATE_IDS,
  TEMPLATE_PAGE_TYPES,
  queryTemplate
} from './template-query'

export function createTemplateToolsExtension(options: {
  bundledSkillsDirectory: string
}): ExtensionFactory {
  return async (pi) => {
    const { Type } = await import('@earendil-works/pi-ai')
    pi.registerTool({
      name: 'template_query',
      label: '查询内置模板',
      description: '查询 SlideMind 内置 PPTist 模板的页面摘要，或读取指定页面的完整结构。',
      promptSnippet: 'Query bundled PPTist template slides without using shell commands.',
      parameters: Type.Union([
        Type.Object({
          action: Type.Literal('slides'),
          templateId: Type.Union(TEMPLATE_IDS.map((id) => Type.Literal(id))),
          pageType: Type.Optional(Type.Union(
            TEMPLATE_PAGE_TYPES.map((pageType) => Type.Literal(pageType))
          ))
        }, { additionalProperties: false }),
        Type.Object({
          action: Type.Literal('get'),
          templateId: Type.Union(TEMPLATE_IDS.map((id) => Type.Literal(id))),
          index: Type.Integer({ minimum: 0 })
        }, { additionalProperties: false })
      ]),
      async execute(_toolCallId, params) {
        const result = await queryTemplate(options.bundledSkillsDirectory, params)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          details: result
        }
      }
    })
  }
}
