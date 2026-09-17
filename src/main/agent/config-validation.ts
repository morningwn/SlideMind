interface NormalizedConfigInput {
  modelId: string
  apiKey?: string
}

export function normalizeConfigInput(
  input: unknown,
  allowedModelIds: readonly string[],
  hasExistingApiKey: boolean,
): NormalizedConfigInput {
  if (!input || typeof input !== 'object') {
    throw new Error('模型配置格式无效')
  }

  const candidate = input as Record<string, unknown>
  const modelId =
    typeof candidate.modelId === 'string' ? candidate.modelId.trim() : ''
  const apiKey =
    typeof candidate.apiKey === 'string' ? candidate.apiKey.trim() : ''

  if (!allowedModelIds.includes(modelId)) {
    throw new Error('请选择受支持的 DeepSeek 模型')
  }

  if (!apiKey && !hasExistingApiKey) {
    throw new Error('请输入 DeepSeek API Key')
  }

  if (apiKey.length > 4096) {
    throw new Error('API Key 长度超出限制')
  }

  return { modelId, apiKey: apiKey || undefined }
}
