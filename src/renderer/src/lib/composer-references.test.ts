import { describe, expect, it } from 'vitest'
import {
  findComposerReferenceTrigger,
  promptReferenceLabel,
  collectComposerReferences,
  insertComposerReference,
} from './composer-references'

describe('findComposerReferenceTrigger', () => {
  it('finds file and skill queries at the active caret', () => {
    expect(findComposerReferenceTrigger('参考 @docs/brief', 14)).toEqual({
      type: 'file',
      query: 'docs/brief',
      start: 3,
      end: 14,
    })
    expect(findComposerReferenceTrigger('/presentation', 13)).toEqual({
      type: 'skill',
      query: 'presentation',
      start: 0,
      end: 13,
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
      end: 20,
    })
  })

  it('preserves text after a reference inserted in the middle of a message', () => {
    const value = '参考 @brief 然后总结'
    const trigger = findComposerReferenceTrigger(value, 9)!
    const result = insertComposerReference(value, trigger, {
      type: 'file',
      path: 'brief.md',
    })
    expect(result.value).toBe('参考 @brief.md  然后总结')
    expect(result.value.slice(0, result.caret)).toBe('参考 @brief.md ')
  })

  it('inserts the reference at the selected trigger and formats visible labels', () => {
    const trigger = findComposerReferenceTrigger('请参考 @brief', 10)!
    expect(
      insertComposerReference('请参考 @brief', trigger, {
        type: 'file',
        path: 'docs/brief.md',
      }),
    ).toEqual({
      value: '请参考 @docs/brief.md ',
      caret: 19,
    })
    expect(promptReferenceLabel({ type: 'file', path: 'docs/brief.md' })).toBe(
      '@docs/brief.md',
    )
    expect(
      promptReferenceLabel({ type: 'skill', name: 'presentation-design' }),
    ).toBe('/presentation-design')
  })
})

describe('collectComposerReferences', () => {
  const first = { type: 'file', path: 'docs/first draft.md' } as const
  const second = { type: 'file', path: 'second.md' } as const
  const skill = { type: 'skill', name: 'design' } as const

  it('follows inline order and includes each selected reference once', () => {
    expect(
      collectComposerReferences(
        '参考 @second.md 对比 @docs/first draft.md 然后 /design @second.md',
        [first, second, skill],
      ),
    ).toEqual([second, first, skill])
  })

  it('drops deleted or partially edited references and restores them on undo', () => {
    expect(
      collectComposerReferences('@second.md.bak /designer', [second, skill]),
    ).toEqual([])
    expect(collectComposerReferences('', [second])).toEqual([])
    expect(collectComposerReferences('@second.md', [second])).toEqual([second])
  })

  it('does not match embedded labels and accepts punctuation after a reference', () => {
    expect(
      collectComposerReferences('test@second.md @second.md，继续', [second]),
    ).toEqual([second])
  })
})
