import { useState, type FormEvent } from 'react'
import { useAgentConfig } from '../hooks/use-agent-config'

interface SettingsPageProps {
  onBack: () => void
}

function BackIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m14.5 6-6 6 6 6" />
    </svg>
  )
}

function ShieldIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19 6v5.2c0 4.3-2.7 7.7-7 9.3-4.3-1.6-7-5-7-9.3V6z" />
      <path d="m9.2 12 1.8 1.8 3.9-4" />
    </svg>
  )
}

export function SettingsPage({ onBack }: SettingsPageProps): React.JSX.Element {
  const {
    config,
    modelId,
    setModelId,
    apiKey,
    setApiKey,
    error,
    isLoading,
    isSaving,
    save
  } = useAgentConfig()
  const [saved, setSaved] = useState(false)

  async function saveSettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaved(false)
    setSaved(await save())
  }

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <header className="settings-toolbar">
        <button className="settings-back" type="button" onClick={onBack}>
          <BackIcon />
          最近项目
        </button>
        <span>SlideMind 设置</span>
      </header>

      <div className="settings-layout">
        <aside className="settings-intro">
          <span className="settings-kicker">模型接入</span>
          <h1 id="settings-title">连接你的思考引擎</h1>
          <p>选择用于生成内容的模型，并管理当前设备上的访问凭证。</p>
          <div className="settings-signal" aria-label="模型接入由供应商、模型和凭证组成">
            <span>供应商</span><i aria-hidden="true" />
            <span>模型</span><i aria-hidden="true" />
            <span>凭证</span>
          </div>
        </aside>

        <form className="provider-settings-card" onSubmit={(event) => void saveSettings(event)}>
          <header>
            <div>
              <span>AI PROVIDER</span>
              <h2>模型供应商</h2>
            </div>
            <span className={!isLoading && config?.configured ? 'provider-status provider-status-ready' : 'provider-status'}>
              <i aria-hidden="true" />
              {isLoading ? '读取中' : config?.configured ? '已连接' : '未配置'}
            </span>
          </header>

          <div className="provider-identity">
            <span aria-hidden="true">DS</span>
            <div>
              <strong>{config?.providerName ?? 'DeepSeek'}</strong>
              <small>当前支持的模型供应商</small>
            </div>
          </div>

          <label>
            <span>接入模型</span>
            <select
              value={modelId}
              onChange={(event) => {
                setModelId(event.target.value)
                setSaved(false)
              }}
              disabled={isLoading || isSaving}
              required
            >
              {config?.models.map((model) => (
                <option value={model.id} key={model.id}>{model.name}</option>
              ))}
            </select>
            <small>{config?.models.find((model) => model.id === modelId)?.description ?? '正在读取可用模型…'}</small>
          </label>

          <label>
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                setSaved(false)
              }}
              placeholder={config?.configured ? '留空以继续使用已保存的 Key' : '输入 DeepSeek API Key'}
              autoComplete="off"
              disabled={isLoading || isSaving}
              required={!config?.configured}
            />
            <small className="credential-note"><ShieldIcon />凭证经系统安全存储加密，仅保存在当前设备。</small>
          </label>

          <div className="settings-form-status" aria-live="polite">
            {error ? <p className="settings-error" role="alert">{error}</p> : null}
            {saved ? <p className="settings-saved">配置已保存，新的对话将使用此模型。</p> : null}
          </div>

          <footer>
            <button type="submit" disabled={isLoading || isSaving || !modelId}>
              {isSaving ? '正在保存…' : '保存更改'}
            </button>
          </footer>
        </form>
      </div>
    </section>
  )
}
