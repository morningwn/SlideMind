import { useEffect, useState } from 'react'
import type { AgentConfigStatus } from '../../../shared/agent'

export interface AgentConfigController {
  config: AgentConfigStatus | null
  modelId: string
  setModelId: (modelId: string) => void
  apiKey: string
  setApiKey: (apiKey: string) => void
  error: string
  isLoading: boolean
  isSaving: boolean
  save: () => Promise<AgentConfigStatus | null>
}

export function useAgentConfig(initialConfig: AgentConfigStatus | null = null): AgentConfigController {
  const [config, setConfig] = useState<AgentConfigStatus | null>(initialConfig)
  const [modelId, setModelId] = useState(initialConfig?.modelId ?? '')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(initialConfig === null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig)
      setModelId(initialConfig.modelId)
      setIsLoading(false)
      return
    }

    let active = true
    void window.agent.getConfig()
      .then((status) => {
        if (!active) return
        setConfig(status)
        setModelId(status.modelId)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '无法读取 Pi Agent 配置')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [initialConfig])

  async function save(): Promise<AgentConfigStatus | null> {
    setIsSaving(true)
    setError('')
    try {
      const status = await window.agent.saveConfig({ modelId, apiKey })
      setConfig(status)
      setModelId(status.modelId)
      setApiKey('')
      return status
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Pi Agent 配置保存失败'
      setError(message)
      return null
    } finally {
      setIsSaving(false)
    }
  }

  return {
    config,
    modelId,
    setModelId,
    apiKey,
    setApiKey,
    error,
    isLoading,
    isSaving,
    save
  }
}
