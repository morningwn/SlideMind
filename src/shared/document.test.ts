import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_DEFAULT_MAX_CHARS,
  DocumentReadError,
  isDocumentPath,
  normalizeDocumentReadInput,
} from './document'

describe('document contract', () => {
  it('recognizes supported Word, Excel, and PDF suffixes', () => {
    expect(isDocumentPath('材料.DOCX')).toBe(true)
    expect(isDocumentPath('legacy.doc')).toBe(true)
    expect(isDocumentPath('数据.XLSX')).toBe(true)
    expect(isDocumentPath('legacy.xls')).toBe(true)
    expect(isDocumentPath('报告.PDF')).toBe(true)
    expect(isDocumentPath('renamed.docx.exe')).toBe(false)
    expect(isDocumentPath('slides.pptx')).toBe(false)
  })

  it('normalizes bounded inputs', () => {
    expect(normalizeDocumentReadInput({ file: '材料.docx' })).toEqual({
      file: '材料.docx',
    })
    expect(DOCUMENT_DEFAULT_MAX_CHARS).toBe(20_000)
    expect(() =>
      normalizeDocumentReadInput({ file: 'a.docx', maxChars: 50_001 }),
    ).toThrow(DocumentReadError)
  })
})
