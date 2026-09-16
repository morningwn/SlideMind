import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEEPSEEK_MODEL_OPTIONS,
  DEEPSEEK_PROVIDER_ID,
} from '../../shared/agent'
import { registerDeepSeekModels } from './deepseek-models'
describe('Pi extension integration', () => {
  it('keeps application DeepSeek models available without pi-free', async () => {
    const agentDirectory = join(
      tmpdir(),
      `slidemind-pi-models-${crypto.randomUUID()}`,
    )
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      authPath: join(agentDirectory, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false,
    })

    registerDeepSeekModels(runtime)
    for (const option of DEEPSEEK_MODEL_OPTIONS) {
      expect(runtime.getModel(DEEPSEEK_PROVIDER_ID, option.id)?.id).toBe(
        option.id,
      )
      expect(
        runtime.getModel(DEEPSEEK_PROVIDER_ID, option.id)?.compat,
      ).toMatchObject({
        supportsLongCacheRetention: false,
      })
    }
  })
})
