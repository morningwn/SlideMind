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
      input: ' 建立一份产品发布演示 ',
      references: [
        { type: 'file', path: ' docs/brief.md ' },
        { type: 'skill', name: 'presentation-design' },
        { type: 'file', path: 'docs/brief.md' }
      ]
    })).toEqual({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
      input: '建立一份产品发布演示',
      references: [
        { type: 'file', path: 'docs/brief.md' },
        { type: 'skill', name: 'presentation-design' }
      ]
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

  it('rejects malformed prompt references', () => {
    const baseInput = {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectHandle: 'project-handle-1',
      input: 'hello'
    }

    expect(() => normalizeAgentPromptInput({
      ...baseInput,
      references: [{ type: 'file', path: '../\0secret' }]
    })).toThrow('Agent 文件引用无效')
    expect(() => normalizeAgentPromptInput({
      ...baseInput,
      references: [{ type: 'skill', name: '../secret' }]
    })).toThrow('Agent skill 引用无效')
    expect(() => normalizeAgentPromptInput({
      ...baseInput,
      references: Array.from({ length: 21 }, (_, index) => ({
        type: 'file',
        path: `${index}.md`
      }))
    })).toThrow('Agent 引用格式无效')
  })

})
