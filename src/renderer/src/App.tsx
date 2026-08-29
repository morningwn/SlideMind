import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import type { AgentConfigStatus } from '../../shared/agent'
import { getPlatformLabel } from './lib/platform'

const recentDecks = [
  { title: '产品叙事草稿', meta: '12 张 · 今天' },
  { title: 'Q4 路线图', meta: '18 张 · 8 月 26 日' }
]

function App(): React.JSX.Element {
  const [notice, setNotice] = useState('')
  const [agentConfig, setAgentConfig] = useState<AgentConfigStatus | null>(null)
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [configError, setConfigError] = useState('')
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const stackRef = useRef<HTMLDivElement>(null)
  const configDialogRef = useRef<HTMLDialogElement>(null)
  const platform = getPlatformLabel(window.desktop.platform)
  const shortcutModifier = window.desktop.platform === 'darwin' ? '⌘' : 'Ctrl'

  useEffect(() => {
    let active = true

    void window.agent
      .getConfig()
      .then((config) => {
        if (!active) return
        setAgentConfig(config)
        setModelId(config.modelId)
        setIsConfigOpen(!config.configured)
      })
      .catch((error: unknown) => {
        if (!active) return
        setConfigError(error instanceof Error ? error.message : '无法读取模型配置')
        setIsConfigOpen(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const dialog = configDialogRef.current
    if (!dialog) return

    if (isConfigOpen && !dialog.open) {
      dialog.showModal()
    } else if (!isConfigOpen && dialog.open) {
      dialog.close()
    }
  }, [isConfigOpen])

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const element = stackRef.current
    if (!element) return

    const bounds = element.getBoundingClientRect()
    const rotateX = ((event.clientY - bounds.top) / bounds.height - 0.5) * -5
    const rotateY = ((event.clientX - bounds.left) / bounds.width - 0.5) * 7
    element.style.setProperty('--rotate-x', `${rotateX.toFixed(2)}deg`)
    element.style.setProperty('--rotate-y', `${rotateY.toFixed(2)}deg`)
  }

  function resetCardTilt(): void {
    const element = stackRef.current
    if (!element) return
    element.style.setProperty('--rotate-x', '0deg')
    element.style.setProperty('--rotate-y', '0deg')
  }

  function announce(message: string): void {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2400)
  }

  function openModelConfig(): void {
    setModelId(agentConfig?.modelId ?? '')
    setApiKey('')
    setConfigError('')
    setIsConfigOpen(true)
  }

  function closeModelConfig(): void {
    if (isSavingConfig) return
    setApiKey('')
    setConfigError('')
    setIsConfigOpen(false)
  }

  async function saveModelConfig(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIsSavingConfig(true)
    setConfigError('')

    try {
      const config = await window.agent.saveConfig({ modelId, apiKey })
      setAgentConfig(config)
      setApiKey('')
      setIsConfigOpen(false)
      announce(`已启用 ${config.modelName}`)
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : '模型配置保存失败')
    } finally {
      setIsSavingConfig(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="SlideMind 首页">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>SlideMind</span>
        </a>
        <div className="topbar-actions">
          <div className="runtime-badge" title={`Electron ${window.desktop.versions.electron}`}>
            {platform}
          </div>
          <button className="model-settings" type="button" onClick={openModelConfig}>
            <span
              className={`status-dot ${agentConfig?.configured ? '' : 'status-dot-pending'}`}
              aria-hidden="true"
            />
            {agentConfig?.configured ? agentConfig.modelName : '配置 AI 模型'}
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">演示，从思路开始</p>
          <h1>
            先想清楚，
            <em>再做成幻灯片。</em>
          </h1>
          <p className="intro">
            把零散材料收进同一张叙事地图，梳理重点、顺序与节奏，再进入每一页的设计。
          </p>
          <div className="hero-actions">
            <button className="primary-action" type="button" onClick={() => announce('新演示工作区已准备好')}>
              新建演示
              <span aria-hidden="true">↗</span>
            </button>
            <button className="secondary-action" type="button" onClick={() => announce('文件选择器将在编辑器模块中接入')}>
              打开文件
            </button>
          </div>
          <p className="shortcut-hint">
            <kbd>{shortcutModifier}</kbd><kbd>N</kbd>
            <span>快速新建</span>
          </p>
        </div>

        <div
          ref={stackRef}
          className="story-stack"
          onPointerMove={handlePointerMove}
          onPointerLeave={resetCardTilt}
          aria-label="演示文稿分镜预览"
        >
          <div className="stack-shadow stack-shadow-one" aria-hidden="true" />
          <div className="stack-shadow stack-shadow-two" aria-hidden="true" />
          <article className="story-card">
            <div className="card-header">
              <span>叙事地图</span>
              <span>6 个章节</span>
            </div>
            <div className="story-line story-line-active">
              <span className="line-number">01</span>
              <div>
                <strong>问题不是缺少功能</strong>
                <small>开场 · 建立共同感受</small>
              </div>
            </div>
            <div className="story-line">
              <span className="line-number">02</span>
              <div>
                <strong>而是想法没有主线</strong>
                <small>冲突 · 解释真正阻力</small>
              </div>
            </div>
            <div className="story-line">
              <span className="line-number">03</span>
              <div>
                <strong>让每一页只说一件事</strong>
                <small>转折 · 提出清晰方法</small>
              </div>
            </div>
            <div className="card-footer">
              <div className="progress-track" aria-hidden="true">
                <span />
              </div>
              <span>3 / 6</span>
            </div>
          </article>
        </div>
      </section>

      <section className="recents" aria-labelledby="recent-title">
        <div className="section-heading">
          <h2 id="recent-title">最近编辑</h2>
          <span>本机草稿</span>
        </div>
        <div className="recent-list">
          {recentDecks.map((deck, index) => (
            <button
              className="recent-item"
              type="button"
              key={deck.title}
              onClick={() => announce(`正在打开“${deck.title}”`)}
            >
              <span className={`deck-swatch swatch-${index + 1}`} aria-hidden="true" />
              <span className="deck-copy">
                <strong>{deck.title}</strong>
                <small>{deck.meta}</small>
              </span>
              <span className="open-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <div className={`toast ${notice ? 'toast-visible' : ''}`} role="status" aria-live="polite">
        {notice}
      </div>

      <dialog
        ref={configDialogRef}
        className="model-dialog"
        aria-labelledby="model-dialog-title"
        onCancel={(event) => {
          event.preventDefault()
          closeModelConfig()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeModelConfig()
        }}
      >
        <div className="model-dialog-card">
          <aside className="model-dialog-aside" aria-hidden="true">
            <span className="agent-orbit"><span>AI</span></span>
            <div>
              <strong>SlideMind Agent</strong>
              <small>由 Pi 驱动</small>
            </div>
          </aside>

          <form className="model-config-form" onSubmit={(event) => void saveModelConfig(event)}>
            <div className="dialog-heading">
              <p className="eyebrow">AI 引擎</p>
              <h2 id="model-dialog-title">
                {agentConfig?.configured ? '调整模型配置' : '开始前，配置模型'}
              </h2>
              <p>
                SlideMind 暂时使用 DeepSeek。API Key 会加密保存在这台设备上，保存后不会回传给页面代码。
              </p>
            </div>

            <label className="config-field">
              <span>服务商</span>
              <span className="provider-field">
                <strong>DeepSeek</strong>
                <small>api.deepseek.com</small>
              </span>
            </label>

            <label className="config-field">
              <span>模型</span>
              <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
                {(agentConfig?.models ?? []).map((model) => (
                  <option value={model.id} key={model.id}>
                    {model.name} — {model.description}
                  </option>
                ))}
              </select>
            </label>

            <label className="config-field">
              <span>API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={agentConfig?.configured ? '留空以继续使用已保存的 Key' : 'sk-...'}
                autoComplete="off"
                spellCheck={false}
                required={!agentConfig?.configured}
              />
            </label>

            {configError ? <p className="config-error" role="alert">{configError}</p> : null}

            <div className="dialog-actions">
              <button className="secondary-action" type="button" onClick={closeModelConfig} disabled={isSavingConfig}>
                {agentConfig?.configured ? '取消' : '稍后配置'}
              </button>
              <button className="primary-action" type="submit" disabled={isSavingConfig || !modelId}>
                {isSavingConfig ? '正在保存…' : '保存并启用'}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </main>
  )
}

export default App
