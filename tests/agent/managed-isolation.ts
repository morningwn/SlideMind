import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { BaseAgentService } from '../../src/main/agent/base-agent'
import { AGENT_TOOL_NAMES } from '../../src/main/agent/managed-permissions'
import { todosFromSessionEntries } from '../../src/main/agent/agent-todo'

export async function verify(
  fixture: { project: string; agent: string; skills: string },
  phase: (value: string) => void,
) {
  phase('initialize')
  const requests: { key: string; model: string }[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
    assert.equal(request.headers.get('x-external-configuration'), null)
    assert.equal(request.headers.get('openai-organization'), null)
    assert.equal(request.headers.get('openai-project'), null)
    const body = await request.json()
    assert.equal(body.prompt_cache_retention, undefined)
    assert.equal(
      JSON.stringify(body).includes('UNTRUSTED_CONFIGURATION'),
      false,
    )
    requests.push({
      key: request.headers.get('authorization')!,
      model: body.model,
    })
    const last = body.messages.at(-1)
    const content = body.messages.findLast(
      (message: { role: string }) => message.role === 'user',
    )?.content
    const task =
      typeof content === 'string'
        ? content
        : content?.map((block: { text?: string }) => block.text ?? '').join('')
    const tool =
      last?.role === 'user' && task === 'create task'
        ? {
            name: 'todo',
            arguments: JSON.stringify({
              action: 'add',
              subject: 'Preserved task',
            }),
          }
        : last?.role === 'user' && task === 'write artifact'
          ? {
              name: 'write',
              arguments: JSON.stringify({
                path: 'artifact.md',
                content: 'Preserved artifact',
              }),
            }
          : undefined
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call-${requests.length}`,
              type: 'function',
              function: tool,
            },
          ],
        }
      : { role: 'assistant', content: 'done' }
    const event = {
      id: 'isolated-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: body.model,
      choices: [
        { index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    }
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  let config = { apiKey: 'fake-app-first', modelId: 'deepseek-flash' }
  const service = new BaseAgentService(
    { load: async () => ({ ...config }) } as never,
    { resolve: () => fixture.project } as never,
    fixture.agent,
    fixture.skills,
    {} as never,
    {
      run: async (_input: unknown, operation: () => Promise<unknown>) =>
        operation(),
    } as never,
    {} as never,
  )
  const internal = service as unknown as {
    sessions: Map<string, { agent: AgentSession }>
  }
  const input = {
    projectHandle: 'project',
    conversationId: `probe-${crypto.randomUUID()}`,
  }
  const current = () =>
    internal.sessions.get(`project\0${input.conversationId}`)!.agent
  let requestId = 0
  const notifications: string[] = []
  const prompt = (text: string, conversationId = input.conversationId) => {
    const id = String(++requestId)
    return service.prompt(
      {
        ...input,
        conversationId,
        requestId: id,
        input: text,
        thinkingLevel: 'off',
      },
      undefined,
      (event) => {
        assert.equal(event.requestId, id)
        notifications.push(id)
      },
    )
  }
  try {
    assert.ok((await service.listSkills('project')).length > 0)
    phase('prompt-and-tool-execution')
    await prompt('create task')
    await prompt('write artifact')
    assert.equal(
      await readFile(join(fixture.project, 'artifact.md'), 'utf8'),
      'Preserved artifact',
    )
    assert.equal((await service.getTodos(input))[0].subject, 'Preserved task')
    const first = current()
    const firstLeaf = first.sessionManager.getLeafId()!
    assert.deepEqual(
      first.modelRuntime.getProviders().map((provider) => provider.id),
      ['deepseek'],
    )
    for (let index = 0; index < 2; index++) {
      phase('reload')
      const notificationCount = notifications.length
      await first.reload()
      assert.equal(notifications.length, notificationCount)
      assert.equal(first.settingsManager.getCompactionSettings().enabled, true)
      assert.deepEqual(
        first.getActiveToolNames().sort(),
        [...AGENT_TOOL_NAMES].sort(),
      )
      assert.equal(
        todosFromSessionEntries(first.sessionManager.getBranch()).length,
        1,
      )
      await prompt('reload request')
    }
    phase('configuration-change-and-history-restore')
    config = { modelId: 'deepseek-v4-pro', apiKey: 'fake-app-second' }
    await prompt('changed configuration')
    assert.notEqual(current(), first)
    assert.equal(current().model!.id, config.modelId)
    assert.ok(current().sessionManager.getEntry(firstLeaf))
    assert.equal((await service.getTodos(input))[0].subject, 'Preserved task')
    assert.equal(requests.at(-1)!.key, 'Bearer fake-app-second')
    assert.equal(requests.at(-1)!.model, config.modelId)
    phase('parallel-sessions')
    await Promise.all([
      prompt('parallel first'),
      prompt('parallel second', `parallel-${input.conversationId}`),
    ])
    const agents = [...internal.sessions.values()].map((record) => record.agent)
    assert.notEqual(agents[0].modelRuntime, agents[1].modelRuntime)
    phase('native-compaction')
    current().sessionManager.appendMessage({
      role: 'user',
      content: 'synthetic context '.repeat(16000),
      timestamp: Date.now(),
    })
    await prompt('before compaction')
    const compacted = await current().compact()
    assert.ok(compacted.summary)
    assert.equal(
      todosFromSessionEntries(current().sessionManager.getBranch())[0].subject,
      'Preserved task',
    )
    await prompt('after compaction')
    phase('branch')
    await current().navigateTree(firstLeaf, { summarize: false })
    assert.equal(
      todosFromSessionEntries(current().sessionManager.getBranch())[0].subject,
      'Preserved task',
    )
    await prompt('branch request')
    phase('resume')
    service.reset()
    await prompt('restored request')
    assert.equal((await service.getTodos(input))[0].subject, 'Preserved task')
    assert.equal(
      current().settingsManager.getCompactionSettings().enabled,
      true,
    )
    assert.equal(requests[0].key, 'Bearer fake-app-first')
    return {
      requests: requests.length,
      lifecycle: [
        'startup',
        'tools',
        'reload',
        'configuration-change',
        'parallel-sessions',
        'native-compaction',
        'branch',
        'resume',
      ],
      providers: ['deepseek'],
    }
  } finally {
    service.reset()
    globalThis.fetch = originalFetch
  }
}
