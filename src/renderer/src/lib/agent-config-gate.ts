import type { AgentConfigStatus } from '../../../shared/agent'

export type AgentConfigGate = 'checking' | 'ready' | 'required'

export function resolveAgentConfigGate(
  isChecked: boolean,
  config: AgentConfigStatus | null
): AgentConfigGate {
  if (!isChecked) return 'checking'
  if (config && !config.configured) return 'required'
  return 'ready'
}
