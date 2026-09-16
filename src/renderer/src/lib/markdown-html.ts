import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function renderMarkdownHtml(source: string): string {
  const rendered = marked.parse(source, { async: false, gfm: true })
  const sanitized = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'style',
      'iframe',
      'object',
      'embed',
      'audio',
      'video',
      'source',
      'track',
      'picture',
    ],
  })
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html')
  for (const image of parsed.querySelectorAll('img')) {
    const sourcePath = image.getAttribute('src')
    image.removeAttribute('src')
    image.removeAttribute('srcset')
    if (sourcePath) image.dataset.projectSource = sourcePath
  }
  return parsed.body.innerHTML
}
