import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentConfigStore } from './config-store'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: () => 'sk-test',
    encryptString: (value: string) => Buffer.from(value),
  },
}))
vi.mock('../logging/logger', () => ({ getLogger: () => ({ warn: vi.fn() }) }))

describe('AgentConfigStore', () => {
  let directory: string
  let configPath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'slidemind-config-'))
    configPath = join(directory, 'config.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.each([
    ['deepseek-v4-flash', 'deepseek-flash'],
    ['deepseek-v4-flash-vision-exp', 'deepseek-flash'],
    ['deepseek-flash', 'deepseek-flash'],
    ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ])(
    'loads %s as %s and retains the existing key',
    async (storedId, modelId) => {
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          provider: 'deepseek',
          modelId: storedId,
          encryptedApiKey: 'dGVzdA==',
        }),
      )
      const store = new AgentConfigStore(configPath)
      expect(await store.load()).toEqual({ modelId, apiKey: 'sk-test' })
      expect(await store.getStatus()).toMatchObject({
        configured: true,
        modelId,
      })
      expect(await store.save({ modelId, apiKey: '' })).toMatchObject({
        configured: true,
        modelId,
      })
    },
  )

  it('rejects an unknown stored model', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        provider: 'deepseek',
        modelId: 'unknown',
        encryptedApiKey: 'dGVzdA==',
      }),
    )
    expect(await new AgentConfigStore(configPath).load()).toBeUndefined()
  })
})
