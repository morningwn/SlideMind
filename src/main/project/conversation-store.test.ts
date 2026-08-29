import { SessionManager } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectConversationState } from '../../shared/project'
import { ProjectConversationStore } from './conversation-store'

const conversationState: ProjectConversationState = {
  selectedConversationId: 'conversation-1',
  conversations: [
    {
      id: 'conversation-1',
      title: '季度汇报'
    }
  ]
}

function appendExchange(session: SessionManager, userText: string, assistantText: string): void {
  session.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: userText }],
    timestamp: 1
  })
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: assistantText }],
    api: 'deepseek-messages',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: 2
  })
}

describe('ProjectConversationStore', () => {
  it('returns null when a project has no conversation record', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))

    expect(await new ProjectConversationStore().load(projectPath)).toBeNull()
  })

  it('persists only the version 2 conversation index inside the project', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))
    const store = new ProjectConversationStore()

    await store.save(projectPath, conversationState)

    expect(await store.load(projectPath)).toEqual(conversationState)
    expect(JSON.parse(await readFile(join(projectPath, '.slideMind', 'conversations.json'), 'utf8')))
      .toEqual({ version: 2, ...conversationState })
  })

  it('loads visible messages from the original Pi JSONL session', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))
    const conversationsDirectory = join(projectPath, '.slideMind', 'convs')
    const store = new ProjectConversationStore()
    await store.save(projectPath, conversationState)

    const session = SessionManager.create(projectPath, conversationsDirectory, {
      id: 'conversation-1'
    })
    appendExchange(session, '帮我整理季度汇报', '先确认受众和目标。')

    const similarlyNamedSession = SessionManager.create(projectPath, conversationsDirectory, {
      id: 'prefix_conversation-1'
    })
    appendExchange(similarlyNamedSession, '另一段对话', '不应被当前会话加载。')

    expect(await store.loadMessages(projectPath, 'conversation-1')).toEqual([
      { id: expect.any(String), role: 'user', text: '帮我整理季度汇报' },
      { id: expect.any(String), role: 'assistant', text: '先确认受众和目标。' }
    ])
  })

  it('serializes writes for the same project', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))
    const store = new ProjectConversationStore()
    const latestState = {
      ...conversationState,
      conversations: [{ ...conversationState.conversations[0], title: '最新标题' }]
    }

    await Promise.all([
      store.save(projectPath, conversationState),
      store.save(projectPath, latestState)
    ])

    expect(await store.load(projectPath)).toEqual(latestState)
  })

  it('rejects malformed data without overwriting it', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))
    const storagePath = join(projectPath, '.slideMind')
    await mkdir(storagePath)
    await writeFile(join(storagePath, 'conversations.json'), JSON.stringify({
      version: 1,
      ...conversationState
    }))

    await expect(new ProjectConversationStore().load(projectPath)).rejects.toThrow(
      '项目会话记录格式无效'
    )
  })

  it('rejects a symbolic-link storage directory', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-outside-'))
    await symlink(outsidePath, join(projectPath, '.slideMind'))

    await expect(new ProjectConversationStore().save(projectPath, conversationState)).rejects.toThrow(
      '项目会话存储目录无效'
    )
  })

  it('rejects a symbolic-link Pi conversation directory', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))
    const outsidePath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-outside-'))
    await mkdir(join(projectPath, '.slideMind'))
    await symlink(outsidePath, join(projectPath, '.slideMind', 'convs'))

    await expect(
      new ProjectConversationStore().loadMessages(projectPath, 'conversation-1')
    ).rejects.toThrow('Pi 会话存储目录无效')
  })

  it('rejects invalid state at the persistence boundary', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))

    await expect(new ProjectConversationStore().save(projectPath, {
      conversations: [],
      selectedConversationId: ''
    })).rejects.toThrow('项目会话记录无效')
  })
})
