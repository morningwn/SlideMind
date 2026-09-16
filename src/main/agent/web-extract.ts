import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { WebError } from './web-transport'

const require = createRequire(import.meta.url)

// Only fixed, application dependencies are loaded. The DOM never executes scripts
// or requests subresources; the worker bounds parser memory and execution time.
const PARSER = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const { parseHTML } = require(workerData.domModule)
const { Readability } = require(workerData.readerModule)
const { document } = parseHTML(workerData.html)
const article = new Readability(document, { maxElemsToParse: 50000 }).parse()
let text = ''
if (article) {
  const content = parseHTML('<html><body>' + article.content + '</body></html>').document
  for (const node of content.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,br')) {
    node.before(content.createTextNode('\n'))
    node.after(content.createTextNode('\n'))
  }
  text = content.body.textContent.replace(/\n{3,}/g, '\n\n').trim()
}
parentPort.postMessage(article ? {
  title: article.title || '', text: text.slice(0, 500000)
} : null)
`

export async function extractWebHtml(
  html: string,
  signal: AbortSignal,
): Promise<{ title: string; text: string }> {
  signal.throwIfAborted()
  const worker = new Worker(PARSER, {
    eval: true,
    workerData: {
      html,
      domModule: require.resolve('linkedom'),
      readerModule: require.resolve('@mozilla/readability'),
    },
    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
  })
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  try {
    return await new Promise((resolve, reject) => {
      const abort = () => reject(new WebError('网页解析已取消或超时'))
      deadline.addEventListener('abort', abort, { once: true })
      const cleanup = () => deadline.removeEventListener('abort', abort)
      worker.once(
        'message',
        (result: { title: string; text: string } | null) => {
          cleanup()
          if (!result?.text.trim())
            reject(new WebError('未提取到正文；页面可能需要登录或执行脚本'))
          else resolve(result)
        },
      )
      worker.once('error', () => {
        cleanup()
        reject(new WebError('网页解析失败或超过资源限制'))
      })
      worker.once('exit', () => {
        cleanup()
        reject(new WebError('网页解析进程已退出'))
      })
      if (deadline.aborted) abort()
    })
  } finally {
    await worker.terminate()
  }
}
