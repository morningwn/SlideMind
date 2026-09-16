import { describe, expect, it } from 'vitest'
import { searchWeb } from './web-search'
import { requestWeb } from './web-transport'
import { fetchWebSource } from './web-tools'

describe.skipIf(process.env.SLIDEMIND_WEB_LIVE_TEST !== '1')(
  'public Web service smoke',
  () => {
    it('retrieves structured results from anonymous Exa without credentials', async () => {
      const sources = await searchWeb(
        requestWeb,
        'Mozilla Readability official documentation',
        2,
        AbortSignal.timeout(45000),
        { domainFilter: ['github.com'] },
      )
      expect(sources.length).toBeGreaterThan(0)
      expect(
        sources.every(
          (source) => new URL(source.url).hostname === 'github.com',
        ),
      ).toBe(true)
    }, 50000)
    it('extracts a real public HTML document', async () => {
      const source = await fetchWebSource(
        'https://example.com',
        AbortSignal.timeout(45000),
        {
          parsePdf: async () => {
            throw new Error('Unexpected PDF')
          },
        },
      )
      expect(source.title).toBe('Example Domain')
      expect(source.text).toContain('documentation examples')
      expect(source.kind).toBe('page')
    }, 50000)
  },
)
