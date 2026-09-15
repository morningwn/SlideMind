import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TikaParseResult } from './tika-client'
import {
  DocumentReadService,
  type DocumentParser,
  type DocumentRuntime,
} from './document-reader'

class FakeRuntime implements DocumentRuntime {
  restarts = 0
  stops = 0

  async restart(): Promise<void> {
    this.restarts += 1
  }

  async run<T>(operation: (baseUrl: string) => Promise<T>): Promise<T> {
    return operation('http://127.0.0.1:1')
  }

  async stop(): Promise<void> {
    this.stops += 1
  }
}

class FakeParser implements DocumentParser {
  calls = 0
  constructor(
    private readonly implementation: (
      file: string,
      signal?: AbortSignal,
    ) => Promise<TikaParseResult>,
  ) {}

  async parse(
    _baseUrl: string,
    _bytes: Uint8Array,
    file: string,
    signal?: AbortSignal,
  ): Promise<TikaParseResult> {
    this.calls += 1
    return this.implementation(file, signal)
  }
}

let projectPath: string
const services: DocumentReadService[] = []

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'slidemind-document-test-'))
})

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
  await rm(projectPath, { force: true, recursive: true })
})

function createService(
  parser: DocumentParser,
  options: { cacheBytes?: number; maxQueueLength?: number } = {},
) {
  const runtime = new FakeRuntime()
  const service = new DocumentReadService({
    ...options,
    cursorKey: new Uint8Array(32).fill(7),
    parser,
    runtime,
  })
  services.push(service)
  return { runtime, service }
}

function parsed(content: string): TikaParseResult {
  return {
    entries: [
      { 'tk:content': content, 'dc:title': 'Title', private: 'hidden' },
    ],
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
}

describe('DocumentReadService', () => {
  it.each(['sample.xls', 'sample.xlsx', 'sample.pdf'])(
    'accepts the supported document path %s',
    async (file) => {
      await writeFile(join(projectPath, file), 'fake document')
      const { service } = createService(
        new FakeParser(async () => parsed('content')),
      )

      await expect(service.read(projectPath, { file })).resolves.toMatchObject({
        content: 'content',
        file,
      })
    },
  )

  it('rejects unsupported document suffixes before parsing', async () => {
    await writeFile(join(projectPath, 'sample.pptx'), 'fake presentation')
    const parser = new FakeParser(async () => parsed('never'))
    const { service } = createService(parser)

    await expect(
      service.read(projectPath, { file: 'sample.pptx' }),
    ).rejects.toMatchObject({ code: 'unsupported_format' })
    expect(parser.calls).toBe(0)
  })

  it('reads a snapshot and continues with a signed cursor without reparsing', async () => {
    await writeFile(join(projectPath, 'sample.docx'), 'fake document')
    const parser = new FakeParser(async () =>
      parsed('第一段内容\n\n第二段内容'),
    )
    const { service } = createService(parser)

    const first = await service.read(projectPath, {
      file: 'sample.docx',
      maxChars: 7,
    })
    expect(first.content).toBe('第一段内容\n\n')
    expect(first.nextCursor).toBeTruthy()
    expect(first.metadata).toEqual({ 'dc:title': ['Title'] })
    const second = await service.read(projectPath, {
      cursor: first.nextCursor,
      file: 'sample.docx',
      maxChars: 20,
    })
    expect(second.content).toBe('第二段内容')
    expect(second.nextCursor).toBeUndefined()
    expect(parser.calls).toBe(1)
  })

  it('rejects an old cursor after the source file changes', async () => {
    const file = join(projectPath, 'sample.docx')
    await writeFile(file, 'version one')
    const { service } = createService(
      new FakeParser(async () => parsed('abcdefghij')),
    )
    const first = await service.read(projectPath, {
      file: 'sample.docx',
      maxChars: 4,
    })
    await writeFile(file, 'version two')

    await expect(
      service.read(projectPath, {
        cursor: first.nextCursor,
        file: 'sample.docx',
      }),
    ).rejects.toMatchObject({ code: 'file_changed' })
  })

  it('returns cursor_expired when parsed content cannot fit in the cache', async () => {
    await writeFile(join(projectPath, 'sample.docx'), 'document')
    const { service } = createService(
      new FakeParser(async () => parsed('abcdefghij')),
      { cacheBytes: 4 },
    )
    const first = await service.read(projectPath, {
      file: 'sample.docx',
      maxChars: 4,
    })
    await expect(
      service.read(projectPath, {
        cursor: first.nextCursor,
        file: 'sample.docx',
      }),
    ).rejects.toMatchObject({ code: 'cursor_expired' })
  })

  it('rejects a modified cursor signature', async () => {
    await writeFile(join(projectPath, 'sample.docx'), 'document')
    const { service } = createService(
      new FakeParser(async () => parsed('abcdefghij')),
    )
    const first = await service.read(projectPath, {
      file: 'sample.docx',
      maxChars: 4,
    })
    const cursor = first.nextCursor!
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`
    await expect(
      service.read(projectPath, { cursor: tampered, file: 'sample.docx' }),
    ).rejects.toMatchObject({ code: 'invalid_cursor' })
  })

  it('coalesces concurrent parsing and lets one waiter cancel independently', async () => {
    await writeFile(join(projectPath, 'sample.docx'), 'document')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const parser = new FakeParser(async (_file, signal) => {
      await gate
      expect(signal?.aborted).toBe(false)
      return parsed('shared result')
    })
    const { runtime, service } = createService(parser)
    const controller = new AbortController()
    const cancelled = service.read(
      projectPath,
      { file: 'sample.docx' },
      controller.signal,
    )
    const completed = service.read(projectPath, { file: 'sample.docx' })
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    release()
    await expect(completed).resolves.toMatchObject({ content: 'shared result' })
    expect(parser.calls).toBe(1)
    expect(runtime.restarts).toBe(0)
  })

  it('recycles the runtime when every waiter cancels an active parse', async () => {
    await writeFile(join(projectPath, 'sample.docx'), 'document')
    const parser = new FakeParser(
      async (_file, signal) =>
        new Promise<TikaParseResult>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          )
        }),
    )
    const { runtime, service } = createService(parser)
    const controller = new AbortController()
    const pending = service.read(
      projectPath,
      { file: 'sample.docx' },
      controller.signal,
    )
    while (parser.calls === 0)
      await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    while (runtime.restarts === 0)
      await new Promise<void>((resolve) => setImmediate(resolve))
    expect(runtime.restarts).toBe(1)
  })

  it('bounds the serial parsing queue', async () => {
    await Promise.all(
      ['one.docx', 'two.docx', 'three.docx'].map((file) =>
        writeFile(join(projectPath, file), file),
      ),
    )
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const parser = new FakeParser(async (file) => {
      await gate
      return parsed(file)
    })
    const { service } = createService(parser, { maxQueueLength: 1 })
    const first = service.read(projectPath, { file: 'one.docx' })
    while (parser.calls === 0)
      await new Promise<void>((resolve) => setImmediate(resolve))
    const second = service.read(projectPath, { file: 'two.docx' })
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    await expect(
      service.read(projectPath, { file: 'three.docx' }),
    ).rejects.toMatchObject({ code: 'queue_full' })
    release()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(parser.calls).toBe(2)
  })

  it('rejects traversal and symbolic-link reads before parsing', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'slidemind-document-outside-'))
    try {
      await writeFile(join(outside, 'secret.docx'), 'secret')
      await mkdir(join(projectPath, 'folder'))
      const parser = new FakeParser(async () => parsed('never'))
      const { service } = createService(parser)
      await expect(
        service.read(projectPath, { file: '../secret.docx' }),
      ).rejects.toThrow()
      expect(parser.calls).toBe(0)
    } finally {
      await rm(outside, { force: true, recursive: true })
    }
  })
})
