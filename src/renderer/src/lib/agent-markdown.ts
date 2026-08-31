import { marked, Renderer } from 'marked'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

function isSafeWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const renderer = new Renderer()

renderer.html = ({ text }) => escapeHtml(text)

renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens)
  if (!isSafeWebUrl(href)) return label
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(href)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${label}</a>`
}

renderer.image = ({ href, title, text }) => {
  if (!isSafeWebUrl(href)) return escapeHtml(text)
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
  return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttribute} loading="lazy" referrerpolicy="no-referrer">`
}

export function parseAgentMarkdown(source: string): string {
  return marked.parse(source, {
    async: false,
    gfm: true,
    renderer
  })
}
