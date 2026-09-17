import { describe, expect, it } from 'vitest'
import {
  createToolActivity,
  formatToolArguments,
  toolErrorDetail,
} from './agent-activity'

describe('agent activity', () => {
  it('recognizes reading SKILL.md as a skill invocation', () => {
    expect(
      createToolActivity('call-1', 'read', {
        path: '/project/skills/slide-copywriting/SKILL.md',
      }),
    ).toEqual({
      id: 'call-1',
      kind: 'skill',
      name: 'slide-copywriting',
      status: 'running',
      detail: '{\n  "path": "/project/skills/slide-copywriting/SKILL.md"\n}',
    })
  })

  it('keeps regular tools distinct and bounds large arguments', () => {
    const activity = createToolActivity('call-2', 'write', {
      path: 'brief.md',
      content: 'a'.repeat(2_000),
    })

    expect(activity.kind).toBe('tool')
    expect(activity.name).toBe('write')
    expect(activity.detail).toContain('内容已截断')
    expect(activity.detail!.length).toBeLessThan(4_100)
    expect(formatToolArguments(undefined)).toBeUndefined()
  })

  it('extracts bounded text from failed tool results', () => {
    expect(
      toolErrorDetail({
        content: [{ type: 'text', text: 'permission denied' }],
      }),
    ).toBe('permission denied')
    expect(
      toolErrorDetail({ content: [{ type: 'image', data: 'ignored' }] }),
    ).toBeUndefined()
  })
})
