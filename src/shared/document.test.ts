import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_DEFAULT_MAX_CHARS,
  DocumentReadError,
  isDocumentPath,
  normalizeDocumentReadInput
} from './document'

describe('document contract', () => {
  it('recognizes only DOC and DOCX suffixes', () => {
    expect(isDocumentPath('材料.DOCX')).toBe(true)
    expect(isDocumentPath('legacy.doc')).toBe(true)
    expect(isDocumentPath('renamed.docx.exe')).toBe(false)
  })

  it('normalizes bounded inputs', () => {
    expect(normalizeDocumentReadInput({ file: '材料.docx' })).toEqual({ file: '材料.docx' })
    expect(DOCUMENT_DEFAULT_MAX_CHARS).toBe(20_000)
    expect(() => normalizeDocumentReadInput({ file: 'a.docx', maxChars: 50_001 }))
      .toThrow(DocumentReadError)
  })
})
