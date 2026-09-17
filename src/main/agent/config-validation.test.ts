import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEEPSEEK_MODEL_OPTIONS,
} from '../../shared/agent'
import { registerDeepSeekModels } from './deepseek-models'
import { normalizeConfigInput } from './config-validation'

const models = DEEPSEEK_MODEL_OPTIONS.map((model) => model.id)

describe('normalizeConfigInput', () => {
  it('normalizes a new DeepSeek configuration', () => {
    expect(
      normalizeConfigInput(
        { modelId: ' deepseek-flash ', apiKey: ' sk-test ' },
        models,
        false,
      ),
    ).toEqual({ modelId: 'deepseek-flash', apiKey: 'sk-test' })
  })

  it('uses DeepSeek V4.1 Flash as the default model', () => {
    expect(DEFAULT_DEEPSEEK_MODEL_ID).toBe('deepseek-flash')
  })

  it('allows retaining an existing API key', () => {
    expect(
      normalizeConfigInput(
        { modelId: 'deepseek-v4-pro', apiKey: '' },
        models,
        true,
      ),
    ).toEqual({ modelId: 'deepseek-v4-pro', apiKey: undefined })
  })

  it('rejects an unsupported model', () => {
    expect(() =>
      normalizeConfigInput(
        { modelId: 'other-model', apiKey: 'sk-test' },
        models,
        false,
      ),
    ).toThrow('请选择受支持的 DeepSeek 模型')
  })

  it('requires a key for the first configuration', () => {
    expect(() =>
      normalizeConfigInput(
        { modelId: 'deepseek-flash', apiKey: '' },
        models,
        false,
      ),
    ).toThrow('请输入 DeepSeek API Key')
  })

  it('registers current DeepSeek capabilities in the Pi runtime', async () => {
    const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai')
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
    })
    registerDeepSeekModels(runtime)
    const bundledModels = runtime.getModels('deepseek')
    const bundledIds = bundledModels.map((model) => model.id)

    expect(bundledIds).toEqual(expect.arrayContaining(models))
    for (const option of DEEPSEEK_MODEL_OPTIONS) {
      const bundledModel = bundledModels.find((model) => model.id === option.id)
      expect(bundledModel).toBeDefined()
      if (!bundledModel) continue
      expect(getSupportedThinkingLevels(bundledModel)).toEqual(
        option.thinkingLevels,
      )
      expect(bundledModel.input).toEqual(
        option.id === 'deepseek-flash' ? ['text', 'image'] : ['text'],
      )
      expect(bundledModel.contextWindow).toBe(1_000_000)
      expect(bundledModel.maxTokens).toBe(384_000)
      expect(bundledModel.compat).toMatchObject({ thinkingFormat: 'deepseek' })
    }
  })
})
