import { describe, expect, it } from 'vitest'
import { isOpenableProjectFile, projectFileDisplayKind } from './project-file-display'

describe('projectFileDisplayKind', () => {
  it.each([
    ['a directory with a file-like name', { kind: 'directory', path: 'notes.md' }, 'directory'],
    ['a presentation source file', { kind: 'file', path: 'deck.slides.json' }, 'presentation'],
    ['an uppercase presentation suffix', { kind: 'file', path: 'DECK.SLIDES.JSON' }, 'presentation'],
    ['a Markdown file', { kind: 'file', path: 'notes.md' }, 'markdown'],
    ['a long Markdown suffix', { kind: 'file', path: 'notes.MARKDOWN' }, 'markdown'],
    ['a text file', { kind: 'file', path: 'outline.txt' }, 'text'],
    ['a PNG image', { kind: 'file', path: 'images/cover.png' }, 'image'],
    ['an uppercase JPEG image', { kind: 'file', path: 'PHOTO.JPEG' }, 'image'],
    ['a GIF image', { kind: 'file', path: 'animation.gif' }, 'image'],
    ['a WebP image', { kind: 'file', path: 'graphic.webp' }, 'image'],
    ['an unsupported JSON file', { kind: 'file', path: 'data.json' }, 'other']
  ] as const)('classifies %s', (_case, entry, expected) => {
    expect(projectFileDisplayKind(entry)).toBe(expected)
  })
})

describe('isOpenableProjectFile', () => {
  it.each(['presentation', 'markdown', 'text', 'image'] as const)('opens supported %s files', (kind) => {
    expect(isOpenableProjectFile(kind)).toBe(true)
  })

  it.each(['directory', 'other'] as const)('does not open %s entries', (kind) => {
    expect(isOpenableProjectFile(kind)).toBe(false)
  })
})
