import { describe, expect, it } from 'vitest'
import { normalizeConfigInput } from './config-validation'

const models = ['deepseek-v4-flash', 'deepseek-v4-pro']

describe('normalizeConfigInput', () => {
  it('normalizes a new DeepSeek configuration', () => {
    expect(
      normalizeConfigInput(
        { modelId: ' deepseek-v4-flash ', apiKey: ' sk-test ' },
        models,
        false
      )
    ).toEqual({ modelId: 'deepseek-v4-flash', apiKey: 'sk-test' })
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
    const { deepseekProvider } = await import('@earendil-works/pi-ai/providers/deepseek')
    const bundledIds = deepseekProvider().getModels().map((model) => model.id)

    expect(bundledIds).toEqual(expect.arrayContaining(models))
  })
})
