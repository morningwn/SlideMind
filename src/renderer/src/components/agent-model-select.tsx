import { useEffect, useState } from 'react'
import {
  AGENT_THINKING_LEVEL_OPTIONS,
  DEFAULT_AGENT_THINKING_LEVEL,
  type AgentConfigStatus,
  type AgentThinkingLevel,
} from '../../../shared/agent'

const UNCONFIGURED_VALUE = '__unconfigured__'

interface AgentModelSelectProps {
  disabled?: boolean
  thinkingLevel: AgentThinkingLevel
  onThinkingLevelChange: (thinkingLevel: AgentThinkingLevel) => void
}

export function AgentModelSelect({
  disabled = false,
  thinkingLevel,
  onThinkingLevelChange,
}: AgentModelSelectProps): React.JSX.Element {
  const [config, setConfig] = useState<AgentConfigStatus | null>(null)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let active = true
    void window.agent
      .getConfig()
      .then((status) => {
        if (active) setConfig(status)
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '无法读取模型配置',
          )
      })

    return () => {
      active = false
    }
  }, [])

  const selectedModel = config?.models.find(
    (model) => model.id === config.modelId,
  )
  const supportedThinkingLevels = selectedModel?.thinkingLevels ?? [
    DEFAULT_AGENT_THINKING_LEVEL,
  ]
  const effectiveThinkingLevel = supportedThinkingLevels.includes(thinkingLevel)
    ? thinkingLevel
    : DEFAULT_AGENT_THINKING_LEVEL

  useEffect(() => {
    if (
      selectedModel &&
      !selectedModel.thinkingLevels.includes(thinkingLevel)
    ) {
      const fallback = selectedModel.thinkingLevels.includes(
        DEFAULT_AGENT_THINKING_LEVEL,
      )
        ? DEFAULT_AGENT_THINKING_LEVEL
        : selectedModel.thinkingLevels[0]
      onThinkingLevelChange(fallback)
    }
  }, [onThinkingLevelChange, selectedModel, thinkingLevel])

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

  const selectedModelId = config?.configured
    ? config.modelId
    : UNCONFIGURED_VALUE

  return (
    <>
      <label
        className={`composer-model-select${config?.configured ? ' composer-model-configured' : ''}${error ? ' composer-model-error' : ''}`}
        title={
          error ||
          (config?.configured ? '选择 Pi Agent 模型' : '请先在设置中配置模型')
        }
      >
        <span className="sr-only">Pi Agent 模型</span>
        <i aria-hidden="true" />
        <select
          value={selectedModelId}
          onChange={(event) => void changeModel(event.target.value)}
          disabled={disabled || isSaving || !config}
          aria-label="Pi Agent 模型"
        >
          {!config?.configured ? (
            <option value={UNCONFIGURED_VALUE}>未配置模型</option>
          ) : null}
          {config?.models.map((model) => (
            <option value={model.id} key={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </label>
      <label
        className={`composer-thinking-select composer-thinking-${effectiveThinkingLevel}`}
        title={
          AGENT_THINKING_LEVEL_OPTIONS.find(
            (option) => option.id === effectiveThinkingLevel,
          )?.description
        }
      >
        <span className="sr-only">思考深度</span>
        <i aria-hidden="true">
          <b />
          <b />
          <b />
        </i>
        <select
          value={effectiveThinkingLevel}
          onChange={(event) =>
            onThinkingLevelChange(event.target.value as AgentThinkingLevel)
          }
          disabled={disabled || !config?.configured}
          aria-label="思考深度"
        >
          {AGENT_THINKING_LEVEL_OPTIONS.filter((option) =>
            supportedThinkingLevels.includes(option.id),
          ).map((option) => (
            <option value={option.id} key={option.id}>
              思考 · {option.name}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </label>
      {error ? (
        <span className="sr-only" role="alert">
          {error}
        </span>
      ) : null}
    </>
  )
}
