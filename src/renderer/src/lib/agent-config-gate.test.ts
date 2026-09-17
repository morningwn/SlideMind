import { describe, expect, it } from 'vitest'
import type { AgentConfigStatus } from '../../../shared/agent'
import { resolveAgentConfigGate } from './agent-config-gate'

function configStatus(configured: boolean): AgentConfigStatus {
  return {
    configured,
    provider: 'deepseek',
    providerName: 'DeepSeek',
    modelId: 'deepseek-v4-flash',
    modelName: 'DeepSeek V4 Flash',
    models: [],
  }
}

describe('resolveAgentConfigGate', () => {
  it('waits until the startup configuration check completes', () => {
    expect(resolveAgentConfigGate(false, null)).toBe('checking')
  })

  it('requires setup when DeepSeek is not configured', () => {
    expect(resolveAgentConfigGate(true, configStatus(false))).toBe('required')
  })

  it('continues normally when DeepSeek is configured', () => {
    expect(resolveAgentConfigGate(true, configStatus(true))).toBe('ready')
  })

  it('does not treat a failed configuration read as an unconfigured model', () => {
    expect(resolveAgentConfigGate(true, null)).toBe('ready')
  })
})
