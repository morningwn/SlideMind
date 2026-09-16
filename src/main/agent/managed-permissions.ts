import type {
  ExtensionFactory,
  ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { PI_AGENT_TOOL_NAMES } from './pi-extensions'
import { FilePolicy } from './file-policy'

export const AGENT_TOOL_NAMES = Object.freeze([
  'read',
  'write',
  'edit',
  'grep',
  'find',
  'ls',
  'todo',
  'document_read',
  'pptx_read',
  'slides_create',
  'slides_read',
  'slides_render',
  'slides_review',
  'slides_write',
  'slides_export',
  'template_query',
  ...PI_AGENT_TOOL_NAMES,
])
const ALLOWED = new Set<string>(AGENT_TOOL_NAMES)

export async function authorizeAgentTool(
  policy: FilePolicy,
  name: string,
  value: unknown,
): Promise<void> {
  if (!ALLOWED.has(name)) throw new Error(`工具未授权：${name}`)
  const input = value as Record<string, unknown>
  if (['read', 'write', 'edit'].includes(name))
    await policy.resolve(
      input.path,
      name === 'read' ? 'read' : 'write',
      'file',
      name === 'write',
    )
  else if (['grep', 'find', 'ls'].includes(name))
    await policy.resolve(
      input.path ?? '.',
      'read',
      name === 'grep' ? 'either' : 'directory',
    )
  else if (name === 'download_asset')
    await policy.resolve(input.path, 'write', 'file', true)
  else if (
    name === 'document_read' ||
    name === 'pptx_read' ||
    name.startsWith('slides_')
  ) {
    await policy.resolve(
      input.file,
      name === 'slides_create' || name === 'slides_write' ? 'write' : 'read',
      'file',
      name === 'slides_create',
    )
    if (name === 'slides_export') {
      const output =
        input.output ??
        (input.file as string).replace(/\.slides\.json$/i, '.pptx')
      await policy.resolve(output, 'write', 'file', true)
    }
    if (name === 'slides_write') {
      const slides = input.slides as Array<{
        elements: Array<{ type: string; source?: string }>
      }>
      for (const slide of slides)
        for (const element of slide.elements) {
          if (
            element.type === 'image' &&
            element.source &&
            !element.source.startsWith('data:image/')
          )
            await policy.resolve(element.source, 'read')
        }
    }
  }
}

// Every registered execute path is checked, including direct invocation without tool_call.
export function withManagedPermissions(
  factory: ExtensionFactory,
  policy: FilePolicy,
): ExtensionFactory {
  return (pi) => {
    const registeredNames = new Set<string>()
    const registerTool: ExtensionAPI['registerTool'] = (tool) => {
      if (!ALLOWED.has(tool.name)) throw new Error(`工具未授权：${tool.name}`)
      if (registeredNames.has(tool.name))
        throw new Error(`工具重复注册：${tool.name}`)
      registeredNames.add(tool.name)
      pi.registerTool({
        ...tool,
        execute: async (id, params, signal, update, ctx) => {
          signal?.throwIfAborted()
          await authorizeAgentTool(policy, tool.name, params)
          signal?.throwIfAborted()
          return tool.execute(id, params, signal, update, ctx)
        },
      })
    }
    return factory({ ...pi, registerTool })
  }
}

export const createPermissionGuard: ExtensionFactory = (pi) => {
  pi.on('tool_call', (event) => {
    if (!ALLOWED.has(event.toolName))
      return { block: true, reason: '工具未授权' }
  })
  pi.on('session_start', () => {
    if (pi.getActiveTools().some((name) => !ALLOWED.has(name)))
      throw new Error('会话启用了未授权工具')
  })
}
