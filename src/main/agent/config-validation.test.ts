import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEEPSEEK_MODEL_OPTIONS
} from '../../shared/agent'
import { normalizeConfigInput } from './config-validation'

const models = DEEPSEEK_MODEL_OPTIONS.map((model) => model.id)

describe('normalizeConfigInput', () => {
  it('normalizes a new DeepSeek configuration', () => {
    expect(
      normalizeConfigInput(
        { modelId: ' deepseek-v4-flash-vision-exp ', apiKey: ' sk-test ' },
        models,
        false
      )
    ).toEqual({ modelId: 'deepseek-v4-flash-vision-exp', apiKey: 'sk-test' })
  })

  it('uses DeepSeek V4 Flash Vision Exp as the default model', () => {
    expect(DEFAULT_DEEPSEEK_MODEL_ID).toBe('deepseek-v4-flash-vision-exp')
  })

  it('allows retaining an existing API key', () => {
    expect(
      normalizeConfigInput({ modelId: 'deepseek-v4-pro', apiKey: '' }, models, true)
    ).toEqual({ modelId: 'deepseek-v4-pro', apiKey: undefined })
  })

  it('rejects an unsupported model', () => {
    expect(() =>
      normalizeConfigInput({ modelId: 'other-model', apiKey: 'sk-test' }, models, false)
    ).toThrow('请选择受支持的 DeepSeek 模型')
  })

  it('requires a key for the first configuration', () => {
    expect(() =>
      normalizeConfigInput({ modelId: 'deepseek-v4-flash', apiKey: '' }, models, false)
    ).toThrow('请输入 DeepSeek API Key')
  })

  it('keeps configured model ids aligned with the bundled Pi provider', async () => {
    const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai')
    const { deepseekProvider } = await import('@earendil-works/pi-ai/providers/deepseek')
    const bundledModels = deepseekProvider().getModels()
    const bundledIds = bundledModels.map((model) => model.id)

    expect(bundledIds).toEqual(expect.arrayContaining(models))
    for (const option of DEEPSEEK_MODEL_OPTIONS) {
      const bundledModel = bundledModels.find((model) => model.id === option.id)
      expect(bundledModel).toBeDefined()
      if (!bundledModel) continue
      expect(getSupportedThinkingLevels(bundledModel)).toEqual(option.thinkingLevels)
      if (option.id === 'deepseek-v4-flash-vision-exp') {
        expect(bundledModel.input).toContain('image')
      }
    }
  })
})
