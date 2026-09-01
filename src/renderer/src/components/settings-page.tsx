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

function ModelIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8z" />
      <path d="m4.8 8.2 7.2 4.3 7.2-4.3M12 12.5v8" />
      <circle cx="12" cy="7.5" r="1.5" />
    </svg>
  )
}

function DiagnosticIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 18.5h16M6.5 15.5V11M12 15.5v-8M17.5 15.5v-5" />
      <path d="M4 5.5h16v13H4z" />
    </svg>
  )
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h6l1.8 2h10.2v8.2a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2z" />
      <path d="M3.5 8V6.3a2 2 0 0 1 2-2h3.2l2 2h8.8a2 2 0 0 1 2 2v1.2" />
    </svg>
  )
}

function ExportIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M5 15.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

function CrashReportIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
      <path d="m8.5 14 2-2 2.2 4 2.8-4" />
    </svg>
  )
}

function ClearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="m9 7 .8-3h4.4l.8 3" />
      <path d="m6.5 7 .8 13h9.4l.8-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  )
}

type DiagnosticAction = 'clear' | 'crashes' | 'export' | 'open' | null
type SettingsCategory = 'diagnostics' | 'model'

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
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
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('model')
  const [saved, setSaved] = useState(false)
  const [diagnosticAction, setDiagnosticAction] = useState<DiagnosticAction>(null)
  const [diagnosticError, setDiagnosticError] = useState('')
  const [diagnosticMessage, setDiagnosticMessage] = useState('')

  async function saveSettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaved(false)
    setSaved(await save())
  }

  async function openLogDirectory(): Promise<void> {
    setDiagnosticAction('open')
    setDiagnosticError('')
    setDiagnosticMessage('')
    try {
      await window.desktop.openLogDirectory()
      setDiagnosticMessage('日志目录已打开。')
    } catch (error) {
      setDiagnosticError(actionError(error, '无法打开日志目录'))
    } finally {
      setDiagnosticAction(null)
    }
  }

  async function exportDiagnostics(): Promise<void> {
    setDiagnosticAction('export')
    setDiagnosticError('')
    setDiagnosticMessage('')
    try {
      const result = await window.desktop.exportDiagnosticBundle()
      if (!result.canceled) setDiagnosticMessage('诊断包已导出到所选位置。')
    } catch (error) {
      setDiagnosticError(actionError(error, '无法导出诊断包'))
    } finally {
      setDiagnosticAction(null)
    }
  }

  async function openCrashReportDirectory(): Promise<void> {
    setDiagnosticAction('crashes')
    setDiagnosticError('')
    setDiagnosticMessage('')
    try {
      await window.desktop.openCrashReportDirectory()
      setDiagnosticMessage('崩溃报告目录已打开。')
    } catch (error) {
      setDiagnosticError(actionError(error, '无法打开崩溃报告目录'))
    } finally {
      setDiagnosticAction(null)
    }
  }

  async function clearLogs(): Promise<void> {
    setDiagnosticAction('clear')
    setDiagnosticError('')
    setDiagnosticMessage('')
    try {
      const cleared = await window.desktop.clearLogs()
      if (cleared) setDiagnosticMessage('现有日志已清除。')
    } catch (error) {
      setDiagnosticError(actionError(error, '无法清除日志'))
    } finally {
      setDiagnosticAction(null)
    }
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

      <div className="settings-frame">
        <header className="settings-intro">
          <span className="settings-kicker">PREFERENCES</span>
          <h1 id="settings-title">设置</h1>
          <p>按功能管理 SlideMind 的模型接入与本地诊断。</p>
        </header>

        <div className="settings-layout">
          <nav className="settings-navigation" aria-label="设置分类">
            <span className="settings-navigation-label">设置分类</span>
            <button
              className={activeCategory === 'model' ? 'is-active' : undefined}
              type="button"
              aria-current={activeCategory === 'model' ? 'page' : undefined}
              onClick={() => setActiveCategory('model')}
            >
              <ModelIcon />
              <span>
                <strong>AI 与模型</strong>
                <small>供应商、模型与凭证</small>
              </span>
              <i aria-hidden="true" />
            </button>
            <button
              className={activeCategory === 'diagnostics' ? 'is-active' : undefined}
              type="button"
              aria-current={activeCategory === 'diagnostics' ? 'page' : undefined}
              onClick={() => setActiveCategory('diagnostics')}
            >
              <DiagnosticIcon />
              <span>
                <strong>数据与诊断</strong>
                <small>日志、崩溃报告与导出</small>
              </span>
              <i aria-hidden="true" />
            </button>
            <p className="settings-local-note"><ShieldIcon />设置和凭证仅保存在当前设备。</p>
          </nav>

          <main className="settings-content">
            <header className="settings-section-heading">
              <span>{activeCategory === 'model' ? 'AI & MODEL' : 'DATA & DIAGNOSTICS'}</span>
              <h2>{activeCategory === 'model' ? 'AI 与模型' : '数据与诊断'}</h2>
              <p>
                {activeCategory === 'model'
                  ? '选择生成内容时使用的模型，并安全管理访问凭证。'
                  : '管理保存在本机的运行日志、崩溃报告和诊断数据。'}
              </p>
            </header>

            {activeCategory === 'model' ? (
              <form className="provider-settings-card" onSubmit={(event) => void saveSettings(event)}>
                <header>
                  <div>
                    <span>PROVIDER</span>
                    <h3>模型供应商</h3>
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
            ) : (
              <section className="diagnostic-settings-card" aria-labelledby="diagnostic-settings-title">
                <header>
                  <div>
                    <span>LOCAL DATA</span>
                    <h3 id="diagnostic-settings-title">本地诊断</h3>
                  </div>
                  <span className="diagnostic-local-status"><i aria-hidden="true" />仅存本机</span>
                </header>

                <div className="diagnostic-recorder" aria-label="日志和崩溃报告覆盖主进程、界面和导出任务">
                  <span><i aria-hidden="true" />MAIN</span>
                  <span><i aria-hidden="true" />UI</span>
                  <span><i aria-hidden="true" />WORKER</span>
                  <code>JSONL · 5 × 5 MB</code>
                </div>

                <p className="diagnostic-description">
                  日志经过脱敏并保存在当前设备。原生崩溃报告单独存放，不会自动上传或加入诊断包。
                </p>

                <div className="diagnostic-actions">
                  <button
                    type="button"
                    onClick={() => void openLogDirectory()}
                    disabled={diagnosticAction !== null}
                  >
                    <FolderIcon />
                    <span><strong>打开日志目录</strong><small>查看应用生成的滚动日志</small></span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void openCrashReportDirectory()}
                    disabled={diagnosticAction !== null}
                  >
                    <CrashReportIcon />
                    <span><strong>崩溃报告目录</strong><small>查看本机生成的 minidump</small></span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportDiagnostics()}
                    disabled={diagnosticAction !== null}
                  >
                    <ExportIcon />
                    <span>
                      <strong>{diagnosticAction === 'export' ? '正在导出…' : '导出诊断包'}</strong>
                      <small>生成压缩的 .json.gz 文件</small>
                    </span>
                  </button>
                  <button
                    className="diagnostic-clear-action"
                    type="button"
                    onClick={() => void clearLogs()}
                    disabled={diagnosticAction !== null}
                  >
                    <ClearIcon />
                    <span><strong>清除日志</strong><small>删除当前设备上的历史记录</small></span>
                  </button>
                </div>

                <div className="diagnostic-action-status" aria-live="polite">
                  {diagnosticError
                    ? <p className="settings-error" role="alert">{diagnosticError}</p>
                    : null}
                  {diagnosticMessage ? <p className="settings-saved">{diagnosticMessage}</p> : null}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </section>
  )
}
