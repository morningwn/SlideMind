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
      title: '季度汇报',
      messages: [
        { id: 'message-1', role: 'user', text: '帮我整理季度汇报' },
        { id: 'message-2', role: 'assistant', text: '先确认受众和目标。' }
      ]
    }
  ]
}

describe('ProjectConversationStore', () => {
  it('returns null when a project has no conversation record', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))

    expect(await new ProjectConversationStore().load(projectPath)).toBeNull()
  })

  it('persists conversations inside the project and loads them', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))
    const store = new ProjectConversationStore()

    await store.save(projectPath, conversationState)

    expect(await store.load(projectPath)).toEqual(conversationState)
    expect(JSON.parse(await readFile(join(projectPath, '.slideMind', 'conversations.json'), 'utf8')))
      .toEqual({ version: 1, ...conversationState })
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
    await writeFile(join(storagePath, 'conversations.json'), '{"version":1,"conversations":[]}')

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

  it('rejects invalid state at the persistence boundary', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'slidemind-conversations-'))

    await expect(new ProjectConversationStore().save(projectPath, {
      conversations: [],
      selectedConversationId: ''
    })).rejects.toThrow('项目会话记录无效')
  })
})
