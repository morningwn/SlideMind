import { safeStorage } from 'electron'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEEPSEEK_MODEL_OPTIONS,
  DEEPSEEK_PROVIDER_ID,
  type AgentConfigStatus
} from '../../shared/agent'
import { normalizeConfigInput } from './config-validation'
import { getLogger } from '../logging/logger'

interface StoredAgentConfig {
  version: 1
  provider: typeof DEEPSEEK_PROVIDER_ID
  modelId: string
  encryptedApiKey: string
}

export interface AgentConfiguration {
  modelId: string
  apiKey: string
}

const allowedModelIds: readonly string[] = DEEPSEEK_MODEL_OPTIONS.map((model) => model.id)
const logger = getLogger('agent-config')

function isStoredAgentConfig(value: unknown): value is StoredAgentConfig {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 1 &&
    candidate.provider === DEEPSEEK_PROVIDER_ID &&
    typeof candidate.modelId === 'string' &&
    typeof candidate.encryptedApiKey === 'string'
  )
}

export class AgentConfigStore {
  constructor(private readonly configPath: string) {}

  async load(): Promise<AgentConfiguration | undefined> {
    try {
      const raw = await readFile(this.configPath, 'utf8')
      const stored: unknown = JSON.parse(raw)

      if (!isStoredAgentConfig(stored)) {
        return undefined
      }

      const modelId = stored.modelId === 'deepseek-v4-flash' || stored.modelId === 'deepseek-v4-flash-vision-exp'
        ? 'deepseek-flash'
        : stored.modelId
      if (!allowedModelIds.includes(modelId)) return undefined

      if (!safeStorage.isEncryptionAvailable()) {
        return undefined
      }

      const apiKey = safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64')).trim()
      return apiKey ? { modelId, apiKey } : undefined
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') {
        logger.warn('agent.config_read_failed', { error })
      }
      return undefined
    }
  }

  async getStatus(): Promise<AgentConfigStatus> {
    const config = await this.load()
    const modelId = config?.modelId ?? DEFAULT_DEEPSEEK_MODEL_ID
    const model = DEEPSEEK_MODEL_OPTIONS.find((item) => item.id === modelId) ?? DEEPSEEK_MODEL_OPTIONS[0]

    return {
      configured: Boolean(config),
      provider: DEEPSEEK_PROVIDER_ID,
      providerName: 'DeepSeek',
      modelId: model.id,
      modelName: model.name,
      models: DEEPSEEK_MODEL_OPTIONS.map((item) => ({ ...item }))
    }
  }

  async save(input: unknown): Promise<AgentConfigStatus> {
    const existing = await this.load()
    const normalized = normalizeConfigInput(input, allowedModelIds, Boolean(existing?.apiKey))
    const apiKey = normalized.apiKey ?? existing?.apiKey

    if (!apiKey) {
      throw new Error('请输入 DeepSeek API Key')
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储暂不可用，无法保存 API Key')
    }

    const stored: StoredAgentConfig = {
      version: 1,
      provider: DEEPSEEK_PROVIDER_ID,
      modelId: normalized.modelId,
      encryptedApiKey: safeStorage.encryptString(apiKey).toString('base64')
    }

    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFile(this.configPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await chmod(this.configPath, 0o600)

    return this.getStatus()
  }
}
