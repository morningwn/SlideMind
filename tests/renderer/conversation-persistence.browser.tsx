import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useConversationPersistence } from '../../src/renderer/src/hooks/use-conversation-persistence'
import type { ProjectConversationState } from '../../src/shared/project'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function persistenceTests(): Promise<string[]> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const original = window.projects.saveConversations
  const saved: ProjectConversationState[] = []
  let failure = false
  let error = ''
  Object.assign(window.projects, {
    saveConversations: async (_handle: string, state: ProjectConversationState) => {
      if (failure) throw new Error('disk unavailable')
      saved.push(state)
    }
  })
  const onError = (message: string) => { error = message }
  const state = (title: string) => ({ conversations: [{ id: 'a', title }], selectedConversationId: 'a' })
  function Harness({ title, enabled }: { title: string; enabled: boolean }) {
    useConversationPersistence({ ...state(title), projectHandle: 'test', enabled, onError })
    return null
  }
  try {
    root.render(createElement(Harness, { title: 'disabled', enabled: false }))
    await delay(350)
    assert(Number(saved.length) === 0, 'Disabled persistence wrote over unloaded metadata')
    root.render(createElement(Harness, { title: 'intermediate', enabled: true }))
    await delay(50)
    root.render(createElement(Harness, { title: 'latest', enabled: true }))
    await delay(350)
    assert(Number(saved.length) === 1 && saved[0].conversations[0].title === 'latest', 'Debounce failed to save latest metadata once')
    root.render(createElement(Harness, { title: 'latest', enabled: true }))
    await delay(350)
    assert(Number(saved.length) === 1, 'Unchanged snapshot caused another write')
    failure = true
    root.render(createElement(Harness, { title: 'retry', enabled: true }))
    await delay(350)
    assert(String(error) === 'disk unavailable', 'Save failure was not surfaced')
    failure = false
    root.render(createElement(Harness, { title: 'recovered', enabled: true }))
    await delay(350)
    assert(String(error) === '' && saved.at(-1)?.conversations[0].title === 'recovered', 'Save recovery failed')
    root.render(createElement(Harness, { title: 'unmount flush', enabled: true }))
    await delay(30)
    root.unmount()
    await delay(30)
    assert(saved.at(-1)?.conversations[0].title === 'unmount flush', 'Unmount lost pending metadata')
    return ['Persistence hook: loading gate, debounce, snapshot deduplication, failure recovery and unmount flush']
  } finally {
    root.unmount()
    host.remove()
    Object.assign(window.projects, { saveConversations: original })
  }
}
