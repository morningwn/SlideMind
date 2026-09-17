import DOMPurify from 'dompurify'
import { useMemo, type MouseEvent } from 'react'
import { parseAgentMarkdown } from '../lib/agent-markdown'

interface AgentMarkdownProps {
  source: string
}

export function AgentMarkdown({
  source,
}: AgentMarkdownProps): React.JSX.Element {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(parseAgentMarkdown(source), {
        ALLOWED_TAGS: [
          'a',
          'blockquote',
          'br',
          'code',
          'del',
          'em',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'hr',
          'img',
          'li',
          'ol',
          'p',
          'pre',
          'strong',
          'table',
          'tbody',
          'td',
          'th',
          'thead',
          'tr',
          'ul',
        ],
        ALLOWED_ATTR: [
          'align',
          'alt',
          'href',
          'loading',
          'referrerpolicy',
          'rel',
          'src',
          'target',
          'title',
        ],
        ALLOW_DATA_ATTR: false,
      }),
    [source],
  )

  function openExternalLink(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest('a')
    if (!link) return
    event.preventDefault()
    const href = link.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href))
      window.open(href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      className="chat-message-content"
      onClick={openExternalLink}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
