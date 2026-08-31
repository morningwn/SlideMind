import type { IDocumentBody } from '@univerjs/core'

interface PresentationRichTextSession {
  text: string
  documentData: {
    body?: IDocumentBody
  }
}

interface PresentationTextTransformer {
  clearControls: () => void
}

export function finishPresentationTextSession(
  richText: PresentationRichTextSession,
  transformer: PresentationTextTransformer,
  text: string,
  commit: boolean
): void {
  const body = richText.documentData.body
  if (commit && text !== richText.text && body) {
    const textRun = body.textRuns?.[0]
    body.dataStream = `${text}\r\n`
    body.textRuns = [{ ...textRun, st: 0, ed: text.length }]
    body.paragraphs = undefined
    body.sectionBreaks = undefined
  }

  transformer.clearControls()
}
