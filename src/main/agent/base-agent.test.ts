import { describe, expect, it } from 'vitest'
import { normalizeAgentConversationInput, normalizeAgentPromptInput } from './base-agent'

describe('normalizeAgentConversationInput', () => {
  it('normalizes a project conversation reference', () => {
    expect(normalizeAgentConversationInput({
      conversationId: ' conversation-1 ',
      projectHandle: ' project-handle-1 '
    })).toEqual({
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1'
    })
  })

  it('rejects invalid conversation references', () => {
    expect(() => normalizeAgentConversationInput({
      conversationId: '../conversation-1',
      projectHandle: 'project-handle-1'
    })).toThrow('Agent 会话标识无效')
  })
})

describe('normalizeAgentPromptInput', () => {
  it('normalizes a project conversation prompt', () => {
    expect(normalizeAgentPromptInput({
      requestId: ' request-1 ',
      conversationId: ' conversation-1 ',
      projectHandle: ' project-handle-1 ',
      input: ' 建立一份产品发布演示 '
    })).toEqual({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
      input: '建立一份产品发布演示'
    })
  })

  it('rejects missing session identifiers', () => {
    expect(() => normalizeAgentPromptInput({
      requestId: '',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
      input: 'hello'
    })).toThrow('Agent 会话标识无效')

    expect(() => normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: '../conversation-1',
      projectHandle: 'project-handle-1',
      input: 'hello'
    })).toThrow('Agent 会话标识无效')
  })

  it('rejects invalid project handles', () => {
    expect(() => normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle\0hidden',
      input: 'hello'
    })).toThrow('项目授权无效')

    expect(() => normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      input: 'hello'
    })).toThrow('项目授权无效')
  })

  it('rejects empty and oversized prompts', () => {
    const baseInput = {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1'
    }

    expect(() => normalizeAgentPromptInput({ ...baseInput, input: '   ' }))
      .toThrow('请输入要交给 agent 的内容')
    expect(() => normalizeAgentPromptInput({ ...baseInput, input: 'a'.repeat(100_001) }))
      .toThrow('输入内容长度超出限制')
  })

})
