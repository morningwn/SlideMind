import { toRaw } from 'vue'

export type PresentationState = {
  title: string
  theme: Record<string, unknown>
  slides: Array<Record<string, unknown>>
  viewportSize: number
  viewportRatio: number
}

export function serializePptistPresentation(presentation: PresentationState): string {
  // The deep watcher already tracks edits. Snapshotting does not need to collect
  // reactive dependencies again for every element in the presentation.
  return JSON.stringify({
    title: presentation.title,
    theme: toRaw(presentation.theme),
    slides: toRaw(presentation.slides),
    viewportSize: presentation.viewportSize,
    viewportRatio: presentation.viewportRatio
  })
}
