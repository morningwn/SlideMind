import { useRef, useState, type PointerEvent } from 'react'
import { getPlatformLabel } from './lib/platform'

const recentDecks = [
  { title: '产品叙事草稿', meta: '12 张 · 今天' },
  { title: 'Q4 路线图', meta: '18 张 · 8 月 26 日' }
]

function App(): React.JSX.Element {
  const [notice, setNotice] = useState('')
  const stackRef = useRef<HTMLDivElement>(null)
  const platform = getPlatformLabel(window.desktop.platform)
  const shortcutModifier = window.desktop.platform === 'darwin' ? '⌘' : 'Ctrl'

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

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="SlideMind 首页">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>SlideMind</span>
        </a>
        <div className="runtime-badge" title={`Electron ${window.desktop.versions.electron}`}>
          <span className="status-dot" aria-hidden="true" />
          {platform} 已就绪
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
    </main>
  )
}

export default App
