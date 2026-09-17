import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/error-boundary'
import { reportDiagnosticEvent } from './lib/logger'
import './styles.css'

window.addEventListener('error', (event) => {
  reportDiagnosticEvent(
    'error',
    'renderer.unhandled_error',
    event.error ?? event.message,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  reportDiagnosticEvent('error', 'renderer.unhandled_rejection', event.reason)
})

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element is missing')
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
