import { describe, expect, it, vi } from 'vitest'
import { preparePandocDocument } from './pandoc-document'

const attr = ['', [], []]

describe('preparePandocDocument', () => {
  it('rewrites validated images and removes unsupported link targets', async () => {
    const document = {
      'pandoc-api-version': [1, 23],
      meta: { title: { t: 'MetaString', c: 'untrusted' } },
      blocks: [
        {
          t: 'Para',
          c: [
            {
              t: 'Image',
              c: [attr, [{ t: 'Str', c: '图' }], ['images/a.png', '']],
            },
            {
              t: 'Link',
              c: [attr, [{ t: 'Str', c: '本地' }], ['file:///etc/passwd', '']],
            },
          ],
        },
      ],
    }
    const resolveImage = vi.fn().mockResolvedValue({
      bytes: Buffer.from('png'),
      mimeType: 'image/png',
    })

    const result = await preparePandocDocument(document, resolveImage, 1024)

    expect(resolveImage).toHaveBeenCalledWith('images/a.png')
    expect(JSON.stringify(result.document)).toContain(
      'data:image/png;base64,cG5n',
    )
    expect(JSON.stringify(result.document)).not.toContain('file:///etc/passwd')
    expect((result.document as { meta: unknown }).meta).toEqual({})
    expect(result.warnings).toEqual(['unsupported_link_removed'])
  })

  it('rejects raw HTML before writing a Word document', async () => {
    await expect(
      preparePandocDocument(
        {
          'pandoc-api-version': [1, 23],
          meta: {},
          blocks: [{ t: 'RawBlock', c: ['html', '<img src="x">'] }],
        },
        vi.fn(),
        1024,
      ),
    ).rejects.toMatchObject({ code: 'resource_unsupported' })
  })

  it('enforces the aggregate image limit', async () => {
    await expect(
      preparePandocDocument(
        {
          'pandoc-api-version': [1, 23],
          meta: {},
          blocks: [
            {
              t: 'Para',
              c: [
                { t: 'Image', c: [attr, [], ['a.png', '']] },
                { t: 'Image', c: [attr, [], ['b.png', '']] },
              ],
            },
          ],
        },
        async () => ({ bytes: Buffer.alloc(6), mimeType: 'image/png' }),
        10,
      ),
    ).rejects.toMatchObject({ code: 'resource_invalid' })
  })

  it('reports Mermaid code blocks without discarding the source', async () => {
    const result = await preparePandocDocument(
      {
        'pandoc-api-version': [1, 23],
        meta: {},
        blocks: [
          { t: 'CodeBlock', c: [['', ['mermaid'], []], 'graph TD; A-->B'] },
        ],
      },
      vi.fn(),
      1024,
    )

    expect(result.warnings).toEqual(['mermaid_not_rendered'])
    expect(JSON.stringify(result.document)).toContain(
      'graph TD; A--&gt;B'.replace('&gt;', '>'),
    )
  })
})
