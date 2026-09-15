import { describe, expect, it } from 'vitest'
import { documentChunk, normalizeTikaDocument } from './document-content'

describe('document content', () => {
  it('filters metadata and does not treat the embedded-resource marker as truncation', () => {
    const result = normalizeTikaDocument([{
      'dc:title': ' Example ',
      'secret': 'must not escape',
      'tk:content': '正文\r\n第二行',
      'tk:exception:embedded-resource-limit-reached': 'true'
    }, { 'tk:content': '嵌入附件正文不得进入结果' }])

    expect(result.content).toBe('正文\n第二行')
    expect(result.metadata).toEqual({ 'dc:title': ['Example'] })
    expect(result.extractionStatus).toBe('complete')
  })

  it('reports known output truncation separately from pagination', () => {
    const result = normalizeTikaDocument([{
      'tk:content': 'partial',
      'tk:exception:write-limit-reached': 'true'
    }])
    expect(result.extractionStatus).toBe('partial')
    expect(result.warnings.join(' ')).toContain('输出限制')
  })

  it('chunks on paragraph boundaries without splitting surrogate pairs', () => {
    const content = `first paragraph\n\nsecond 😀 paragraph`
    const first = documentChunk(content, 0, 18)
    expect(first.content).toBe('first paragraph\n\n')
    expect(first.nextOffset).toBe(17)
    const second = documentChunk(content, first.nextOffset!, 8)
    expect(second.content.endsWith('\ud83d')).toBe(false)
  })
})
