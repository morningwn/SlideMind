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
  save: () => Promise<boolean>
}

export function useAgentConfig(): AgentConfigController {
  const [config, setConfig] = useState<AgentConfigStatus | null>(null)
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
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
  }, [])

  async function save(): Promise<boolean> {
    setIsSaving(true)
    setError('')
    try {
      const status = await window.agent.saveConfig({ modelId, apiKey })
      setConfig(status)
      setModelId(status.modelId)
      setApiKey('')
      return true
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Pi Agent 配置保存失败'
      setError(message)
      return false
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
