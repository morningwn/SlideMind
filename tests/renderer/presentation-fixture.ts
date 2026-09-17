import type { PresentationDocument } from '../../src/shared/presentation'

export function presentationFixture(
  pageCount = 1,
  image = '',
): PresentationDocument {
  return {
    format: 'slidemind.presentation',
    version: 2,
    presentation: {
      title: 'PPTist rendering check',
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: {
        backgroundColor: '#ffffff',
        themeColors: ['#2563eb'],
        fontColor: '#183153',
        fontName: 'Arial',
        outline: { width: 2, color: '#525252', style: 'solid' },
        shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
      },
      slides: Array.from({ length: pageCount }, (_, index) => ({
        id: `slide-${index}`,
        background: { type: 'solid', color: '#f4f7fc' },
        elements: [
          {
            id: `title-${index}`,
            type: 'text',
            left: 80,
            top: 70,
            width: 820,
            height: 70,
            rotate: 0,
            content: '<p><strong>PPTist · 跨框架渲染验证</strong></p>',
            defaultFontName: 'Arial',
            defaultColor: '#183153',
          },
          {
            id: `body-${index}`,
            type: 'text',
            left: 80,
            top: 200,
            width: 550,
            height: 170,
            rotate: 0,
            content: `<p>第 ${index + 1} 页 · 编辑 → 保存 → 重新打开</p><p><span style="color: #2563eb">中文、English、颜色与强调</span></p>`,
            defaultFontName: 'Arial',
            defaultColor: '#183153',
          },
          ...(image
            ? [
                {
                  id: `image-${index}`,
                  type: 'image',
                  left: 700,
                  top: 200,
                  width: 160,
                  height: 160,
                  rotate: 0,
                  src: image,
                  fixedRatio: true,
                },
              ]
            : []),
        ],
      })),
    },
  }
}

export function imageFixture(size: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const pixels = context.createImageData(size, size)
  let seed = 42
  for (let index = 0; index < pixels.data.length; index += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    pixels.data[index] = seed & 255
    pixels.data[index + 1] = (seed >>> 8) & 255
    pixels.data[index + 2] = (seed >>> 16) & 255
    pixels.data[index + 3] = 255
  }
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}
