import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

const PERMISSION_SYSTEM_DIRECTORY = 'permission-system'
const PERMISSION_POLICY_FILE = 'pi-permissions.jsonc'
const PERMISSION_CONFIG_FILE = 'config.json'

export interface PermissionSystemSetup {
  extensionPath: string
  policyPath: string
}

function normalizePermissionPath(path: string): string {
  return path.replaceAll('\\', '/')
}

export function createManagedPermissionPolicy(agentDirectory: string): Record<string, unknown> {
  const skillsDirectory = normalizePermissionPath(join(agentDirectory, 'skills'))

  return {
    defaultPolicy: {
      tools: 'deny',
      bash: 'deny',
      mcp: 'deny',
      skills: 'deny',
      special: 'deny'
    },
    tools: {
      '*': 'deny',
      read: 'allow',
      write: 'allow',
      edit: 'allow',
      grep: 'allow',
      find: 'allow',
      ls: 'allow',
      [`write:${skillsDirectory}`]: 'deny',
      [`write:${skillsDirectory}/*`]: 'deny',
      [`edit:${skillsDirectory}`]: 'deny',
      [`edit:${skillsDirectory}/*`]: 'deny'
    },
    bash: {
      '*': 'deny'
    },
    mcp: {
      '*': 'deny'
    },
    skills: {
      '*': 'allow'
    },
    special: {
      '*': 'deny',
      external_directory: 'deny',
      [`external_directory:${skillsDirectory}`]: 'allow',
      [`external_directory:${skillsDirectory}/*`]: 'allow'
    }
  }
}

export async function preparePermissionSystem(
  agentDirectory: string
): Promise<PermissionSystemSetup> {
  const permissionDirectory = join(agentDirectory, PERMISSION_SYSTEM_DIRECTORY)
  const policyPath = join(permissionDirectory, PERMISSION_POLICY_FILE)
  const configPath = join(permissionDirectory, PERMISSION_CONFIG_FILE)
  const logsDirectory = join(permissionDirectory, 'logs')

  await mkdir(permissionDirectory, { recursive: true })
  await Promise.all([
    writeFile(
      policyPath,
      `${JSON.stringify(createManagedPermissionPolicy(agentDirectory), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    ),
    writeFile(
      configPath,
      `${JSON.stringify({
        enabled: true,
        debug: false,
        yoloMode: false,
        forwardedPromptTimeoutSeconds: null
      }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
  ])

  process.env.PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR = permissionDirectory
  process.env.PI_PERMISSION_SYSTEM_CONFIG_PATH = configPath
  process.env.PI_PERMISSION_SYSTEM_LOGS_DIR = logsDirectory

  return {
    extensionPath: require.resolve('pi-permission-system'),
    policyPath
  }
}
