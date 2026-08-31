import { describe, expect, it } from 'vitest'
import { parseAgentMarkdown } from './agent-markdown'

describe('parseAgentMarkdown', () => {
  it('renders common GitHub-flavored Markdown structures', () => {
    const html = parseAgentMarkdown([
      '## 方案',
      '',
      '- **清晰**的叙事',
      '- `可执行` 的步骤',
      '',
      '| 页面 | 目标 |',
      '| --- | --- |',
      '| 开场 | 建立问题 |'
    ].join('\n'))

    expect(html).toContain('<h2>方案</h2>')
    expect(html).toContain('<strong>清晰</strong>')
    expect(html).toContain('<code>可执行</code>')
    expect(html).toContain('<table>')
  })

  it('escapes raw HTML and drops unsafe link destinations', () => {
    const html = parseAgentMarkdown('<img src=x onerror=alert(1)> [运行](javascript:alert(1))')

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('运行')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img src=x')
  })

  it('opens safe links outside the app and protects remote image requests', () => {
    const html = parseAgentMarkdown([
      '[参考](https://example.com "说明")',
      '',
      '![示意图](https://example.com/slide.png)'
    ].join('\n'))

    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('referrerpolicy="no-referrer"')
  })
})
