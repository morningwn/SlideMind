import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { PI_AGENT_TOOL_NAMES } from './pi-extensions'

const require = createRequire(import.meta.url)

const PERMISSION_SYSTEM_DIRECTORY = 'permission-system'
const PERMISSION_POLICY_FILE = 'pi-permissions.jsonc'
const PERMISSION_CONFIG_FILE = 'config.json'

export interface PermissionSystemSetup {
  extensionPath: string
  policyPath: string
}

function normalizePermissionPath(path: string): string {
  const normalizedPath = path.replaceAll('\\', '/')
  return process.platform === 'win32'
    ? normalizedPath.toLowerCase()
    : normalizedPath
}

export function createManagedPermissionPolicy(
  agentDirectory: string,
  readOnlyDirectories: readonly string[] = [],
): Record<string, unknown> {
  const skillsDirectory = normalizePermissionPath(
    join(agentDirectory, 'skills'),
  )
  const protectedDirectories = [
    skillsDirectory,
    ...readOnlyDirectories.map(normalizePermissionPath),
  ]
  const fileToolRules = Object.fromEntries(
    protectedDirectories.flatMap((directory) => [
      [`write:${directory}`, 'deny'],
      [`write:${directory}/*`, 'deny'],
      [`edit:${directory}`, 'deny'],
      [`edit:${directory}/*`, 'deny'],
    ]),
  )
  const externalDirectoryRules = Object.fromEntries(
    protectedDirectories.flatMap((directory) => [
      [`external_directory:${directory}`, 'allow'],
      [`external_directory:${directory}/*`, 'allow'],
    ]),
  )

  return {
    defaultPolicy: {
      tools: 'deny',
      bash: 'deny',
      mcp: 'deny',
      skills: 'deny',
      special: 'deny',
    },
    tools: {
      '*': 'deny',
      read: 'allow',
      write: 'allow',
      edit: 'allow',
      grep: 'allow',
      find: 'allow',
      ls: 'allow',
      todo: 'allow',
      document_read: 'allow',
      pptx_read: 'allow',
      slides_create: 'allow',
      slides_read: 'allow',
      slides_render: 'allow',
      slides_review: 'allow',
      slides_write: 'allow',
      slides_export: 'allow',
      template_query: 'allow',
      ...Object.fromEntries(PI_AGENT_TOOL_NAMES.map((name) => [name, 'allow'])),
      ...fileToolRules,
    },
    bash: {
      '*': 'deny',
    },
    mcp: {
      '*': 'deny',
    },
    skills: {
      '*': 'allow',
    },
    special: {
      '*': 'deny',
      external_directory: 'deny',
      ...externalDirectoryRules,
    },
  }
}

export async function preparePermissionSystem(
  agentDirectory: string,
  readOnlyDirectories: readonly string[] = [],
): Promise<PermissionSystemSetup> {
  const permissionDirectory = join(agentDirectory, PERMISSION_SYSTEM_DIRECTORY)
  const policyPath = join(permissionDirectory, PERMISSION_POLICY_FILE)
  const configPath = join(permissionDirectory, PERMISSION_CONFIG_FILE)
  const logsDirectory = join(permissionDirectory, 'logs')

  await mkdir(permissionDirectory, { recursive: true })
  await Promise.all([
    writeFile(
      policyPath,
      `${JSON.stringify(createManagedPermissionPolicy(agentDirectory, readOnlyDirectories), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    ),
    writeFile(
      configPath,
      `${JSON.stringify(
        {
          enabled: true,
          debug: false,
          yoloMode: false,
          forwardedPromptTimeoutSeconds: null,
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    ),
  ])

  // The retained permission extension still uses getAgentDir() for auxiliary paths.
  process.env.PI_CODING_AGENT_DIR = agentDirectory
  process.env.PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR = permissionDirectory
  process.env.PI_PERMISSION_SYSTEM_CONFIG_PATH = configPath
  process.env.PI_PERMISSION_SYSTEM_LOGS_DIR = logsDirectory

  return {
    extensionPath: require.resolve('pi-permission-system'),
    policyPath,
  }
}
