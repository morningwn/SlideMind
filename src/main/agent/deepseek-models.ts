import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { DEEPSEEK_MODEL_OPTIONS, DEEPSEEK_PROVIDER_ID } from '../../shared/agent'

// Pi 0.85.1 的目录尚未包含 V4.1；沿用其 DeepSeek 协议适配并更新模型契约。
export function registerDeepSeekModels(runtime: ModelRuntime): void {
  runtime.registerProvider(DEEPSEEK_PROVIDER_ID, {
    baseUrl: 'https://api.deepseek.com',
    api: 'openai-completions',
    models: DEEPSEEK_MODEL_OPTIONS.map((option) => ({
      id: option.id,
      name: option.name,
      reasoning: true,
      input: option.id === 'deepseek-flash' ? ['text', 'image'] : ['text'],
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      // 美元/百万 tokens，按官方高峰价格估算；实际扣费以服务商账单为准。
      // https://api-docs.deepseek.com/quick_start/pricing/
      cost: option.id === 'deepseek-flash'
        ? { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }
        : { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
      thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', max: 'max' },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        maxTokensField: 'max_tokens',
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: 'deepseek'
      }
    }))
  })
}
