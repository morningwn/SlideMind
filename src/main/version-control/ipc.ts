import { BrowserWindow, ipcMain } from 'electron'
import type {
  CompareProjectVersionFileInput,
  ProjectVersionCreatedEvent,
  RestoreProjectVersionInput,
} from '../../shared/project-version'
import type { ProjectRootRegistry } from '../project/project-root-registry'
import type { ProjectMutationService } from './project-mutation-service'
import type { ProjectVersionService } from './project-version-service'

function validateVersionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error('版本标识无效')
  }
  return value
}

function validatePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4096 ||
    value.includes('\0')
  ) {
    throw new Error('版本文件路径无效')
  }
  return value
}

function validateComparisonInput(
  value: unknown,
): CompareProjectVersionFileInput {
  if (!value || typeof value !== 'object') throw new Error('版本比较参数无效')
  const input = value as Partial<CompareProjectVersionFileInput>
  if (input.target !== 'current' && input.target !== 'previous') {
    throw new Error('版本比较目标无效')
  }
  return {
    versionId: validateVersionId(input.versionId),
    path: validatePath(input.path),
    target: input.target,
  }
}

function validateRestoreInput(value: unknown): RestoreProjectVersionInput {
  if (!value || typeof value !== 'object') throw new Error('版本恢复参数无效')
  const input = value as Partial<RestoreProjectVersionInput>
  if (
    !Array.isArray(input.files) ||
    input.files.length === 0 ||
    input.files.length > 100
  ) {
    throw new Error('请选择要恢复的文件')
  }
  return {
    versionId: validateVersionId(input.versionId),
    files: input.files.map((file) => {
      if (!file || typeof file !== 'object') throw new Error('版本恢复参数无效')
      const candidate = file as { path?: unknown; currentRevision?: unknown }
      if (
        typeof candidate.currentRevision !== 'string' ||
        !/^(?:missing|[a-f0-9]{64})$/.test(candidate.currentRevision)
      ) {
        throw new Error('版本恢复参数无效')
      }
      return {
        path: validatePath(candidate.path),
        currentRevision: candidate.currentRevision,
      }
    }),
  }
}

export function registerProjectVersionIpc(
  projectRoots: ProjectRootRegistry,
  versions: ProjectVersionService,
  mutations: ProjectMutationService,
): void {
  versions.onCreated(({ projectPath, versionId }) => {
    const projectHandle = projectRoots.handleForPath(projectPath)
    if (!projectHandle) return
    const event: ProjectVersionCreatedEvent = { projectHandle, versionId }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('project-version:created', event)
    }
  })

  ipcMain.handle(
    'project-version:list',
    (_event, projectHandle: unknown, cursor: unknown) => {
      if (cursor !== undefined) validateVersionId(cursor)
      return versions.listVersions(
        projectRoots.resolve(projectHandle),
        cursor as string | undefined,
      )
    },
  )

  ipcMain.handle(
    'project-version:compare-file',
    (_event, projectHandle: unknown, input: unknown) =>
      versions.compareFile(
        projectRoots.resolve(projectHandle),
        validateComparisonInput(input),
      ),
  )

  ipcMain.handle(
    'project-version:restore',
    (_event, projectHandle: unknown, input: unknown) => {
      const projectPath = projectRoots.resolve(projectHandle)
      if (typeof projectHandle !== 'string') throw new Error('项目授权无效')
      return mutations.restoreVersion(
        projectPath,
        projectHandle,
        validateRestoreInput(input),
      )
    },
  )
}
