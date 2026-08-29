import { useEffect, useState } from 'react'
import type { AgentConfigStatus } from '../../../shared/agent'

const UNCONFIGURED_VALUE = '__unconfigured__'

interface AgentModelSelectProps {
  disabled?: boolean
}

export function AgentModelSelect({ disabled = false }: AgentModelSelectProps): React.JSX.Element {
  const [config, setConfig] = useState<AgentConfigStatus | null>(null)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let active = true
    void window.agent.getConfig()
      .then((status) => {
        if (active) setConfig(status)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '无法读取模型配置')
      })

    return () => {
      active = false
    }
  }, [])

  async function changeModel(modelId: string): Promise<void> {
    if (!config?.configured) {
      setError('请先在设置中配置 API Key')
      return
    }

    setError('')
    setIsSaving(true)
    try {
      setConfig(await window.agent.saveConfig({ modelId, apiKey: '' }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型切换失败')
    } finally {
      setIsSaving(false)
    }
  }

  const selectedModelId = config?.configured ? config.modelId : UNCONFIGURED_VALUE

  return (
    <>
      <label
        className={`composer-model-select${config?.configured ? ' composer-model-configured' : ''}${error ? ' composer-model-error' : ''}`}
        title={error || (config?.configured ? '选择 Pi Agent 模型' : '请先在设置中配置模型')}
      >
        <span className="sr-only">Pi Agent 模型</span>
        <i aria-hidden="true" />
        <select
          value={selectedModelId}
          onChange={(event) => void changeModel(event.target.value)}
          disabled={disabled || isSaving || !config}
          aria-label="Pi Agent 模型"
        >
          {!config?.configured ? <option value={UNCONFIGURED_VALUE}>未配置模型</option> : null}
          {config?.models.map((model) => (
            <option value={model.id} key={model.id}>{model.name}</option>
          ))}
        </select>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
      </label>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
    </>
  )
}
