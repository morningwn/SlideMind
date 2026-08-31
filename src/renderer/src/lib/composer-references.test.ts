import { describe, expect, it } from 'vitest'
import {
  findComposerReferenceTrigger,
  promptReferenceLabel,
  removeComposerReferenceTrigger
} from './composer-references'

describe('findComposerReferenceTrigger', () => {
  it('finds file and skill queries at the active caret', () => {
    expect(findComposerReferenceTrigger('参考 @docs/brief', 14)).toEqual({
      type: 'file',
      query: 'docs/brief',
      start: 3,
      end: 14
    })
    expect(findComposerReferenceTrigger('/presentation', 13)).toEqual({
      type: 'skill',
      query: 'presentation',
      start: 0,
      end: 13
    })
  })

  it('ignores inline path separators and closed triggers', () => {
    expect(findComposerReferenceTrigger('docs/brief.md', 13)).toBeNull()
    expect(findComposerReferenceTrigger('@brief 后续内容', 10)).toBeNull()
  })

  it('supports nested file paths without treating their separators as skill triggers', () => {
    expect(findComposerReferenceTrigger('@docs/research/brief', 20)).toEqual({
      type: 'file',
      query: 'docs/research/brief',
      start: 0,
      end: 20
    })
  })

  it('removes only the selected trigger and formats visible labels', () => {
    const trigger = findComposerReferenceTrigger('请参考 @brief', 10)!
    expect(removeComposerReferenceTrigger('请参考 @brief', trigger)).toEqual({
      value: '请参考 ',
      caret: 4
    })
    expect(promptReferenceLabel({ type: 'file', path: 'docs/brief.md' }))
      .toBe('@docs/brief.md')
    expect(promptReferenceLabel({ type: 'skill', name: 'presentation-design' }))
      .toBe('/presentation-design')
  })
})
