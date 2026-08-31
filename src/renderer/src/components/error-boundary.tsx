import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportDiagnosticEvent } from '../lib/logger'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportDiagnosticEvent('error', 'renderer.react_error', error, {
      componentStack: (info.componentStack ?? '').slice(0, 1_000)
    })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className="fatal-error-page">
        <section>
          <p className="eyebrow">SLIDEMIND</p>
          <h1>界面发生异常</h1>
          <p>诊断信息已保存到本地日志。重新加载应用后可以继续操作。</p>
          <button type="button" onClick={() => window.location.reload()}>重新加载</button>
        </section>
      </main>
    )
  }
}
