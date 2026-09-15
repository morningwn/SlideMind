import { describe, expect, it } from 'vitest'
import { activityTitle } from './agent-activity-panel'

describe('activityTitle', () => {
  it('shows a readable label for document_read activity', () => {
    expect(activityTitle({
      id: 'document-call',
      kind: 'tool',
      name: 'document_read',
      status: 'running'
    })).toBe('读取 Word 文档')
  })
})
