import { describe, expect, it } from 'vitest'
import { normalizeAgentPromptInput } from './base-agent'

describe('normalizeAgentPromptInput', () => {
  it('normalizes a project conversation prompt', () => {
    expect(normalizeAgentPromptInput({
      requestId: ' request-1 ',
      conversationId: ' conversation-1 ',
      projectPath: ' /workspace/slides ',
      input: ' 建立一份产品发布演示 '
    })).toEqual({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectPath: '/workspace/slides',
      input: '建立一份产品发布演示'
    })
  })

  it('rejects missing session identifiers', () => {
    expect(() => normalizeAgentPromptInput({
      requestId: '',
      conversationId: 'conversation-1',
      projectPath: '/workspace/slides',
      input: 'hello'
    })).toThrow('Agent 会话标识无效')
  })

  it('rejects invalid project paths', () => {
    expect(() => normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectPath: '/workspace/slides\0hidden',
      input: 'hello'
    })).toThrow('项目路径无效')

    expect(() => normalizeAgentPromptInput({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectPath: 'relative/project',
      input: 'hello'
    })).toThrow('项目路径无效')
  })

  it('rejects empty and oversized prompts', () => {
    const baseInput = {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      projectPath: '/workspace/slides'
    }

    expect(() => normalizeAgentPromptInput({ ...baseInput, input: '   ' }))
      .toThrow('请输入要交给 agent 的内容')
    expect(() => normalizeAgentPromptInput({ ...baseInput, input: 'a'.repeat(100_001) }))
      .toThrow('输入内容长度超出限制')
  })
})
