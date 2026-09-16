import { renderMarkdownHtml } from './src/lib/markdown-html'

declare global {
  interface Window {
    slidemindPdfPage: {
      render(source: string): string[]
      loadImages(images: Record<string, string>): Promise<void>
    }
  }
}

window.slidemindPdfPage = {
  render(source) {
    const article = document.querySelector<HTMLElement>('.markdown-preview')!
    article.innerHTML = renderMarkdownHtml(source)
    const images = [...article.querySelectorAll<HTMLImageElement>('img')]
    if (images.some((image) => !image.dataset.projectSource)) {
      throw new Error('Markdown 图片路径无效')
    }
    return images.map((image) => image.dataset.projectSource!)
  },
  async loadImages(images) {
    const article = document.querySelector<HTMLElement>('.markdown-preview')!
    const nodes = [
      ...article.querySelectorAll<HTMLImageElement>('img[data-project-source]'),
    ]
    for (const image of nodes) {
      const source = image.dataset.projectSource!
      const dataUrl = images[source]
      if (!dataUrl) throw new Error('Markdown 图片资源缺失')
      image.src = dataUrl
    }
    let timeout: number | undefined
    try {
      await Promise.race([
        Promise.all([
          document.fonts.ready,
          ...nodes.map((image) => image.decode()),
        ]),
        new Promise<never>((_resolve, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error('Markdown 图片或字体加载超时')),
            15_000,
          )
        }),
      ])
    } finally {
      window.clearTimeout(timeout)
    }
  },
}
