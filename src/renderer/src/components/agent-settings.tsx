import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AgentConfigStatus } from '../../../shared/agent'

export function AgentSettings(): React.JSX.Element {
  const [config, setConfig] = useState<AgentConfigStatus | null>(null)
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

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

    return () => {
      active = false
    }
  }, [])

  function openSettings(): void {
    setModelId(config?.modelId ?? '')
    setApiKey('')
    setError('')
    dialogRef.current?.showModal()
  }

  function closeSettings(): void {
    if (isSaving) return
    setApiKey('')
    setError('')
    dialogRef.current?.close()
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIsSaving(true)
    setError('')
    try {
      const status = await window.agent.saveConfig({ modelId, apiKey })
      setConfig(status)
      setApiKey('')
      dialogRef.current?.close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pi Agent 配置保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <button
        className={`composer-agent-settings${config?.configured ? ' composer-agent-configured' : ''}`}
        type="button"
        onClick={openSettings}
        title="配置 Pi Agent"
      >
        <i aria-hidden="true" />
        {config?.configured ? `Pi Agent · ${config.modelName}` : '配置 Pi Agent'}
      </button>

      <dialog className="agent-settings-dialog" ref={dialogRef} onCancel={closeSettings}>
        <form onSubmit={(event) => void saveSettings(event)}>
          <header>
            <div>
              <span>PI AGENT</span>
              <h2>模型配置</h2>
            </div>
            <button type="button" onClick={closeSettings} aria-label="关闭配置">×</button>
          </header>

          <label>
            <span>DeepSeek 模型</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {config?.models.map((model) => (
                <option value={model.id} key={model.id}>{model.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={config?.configured ? '留空以继续使用已保存的 Key' : '输入 DeepSeek API Key'}
              autoComplete="off"
              required={!config?.configured}
            />
            <small>API Key 使用系统安全存储加密，仅保存在当前设备。</small>
          </label>

          {error ? <p role="alert">{error}</p> : null}

          <footer>
            <button type="button" onClick={closeSettings} disabled={isSaving}>取消</button>
            <button type="submit" disabled={isSaving || !modelId}>
              {isSaving ? '正在保存…' : '保存配置'}
            </button>
          </footer>
        </form>
      </dialog>
    </>
  )
}
