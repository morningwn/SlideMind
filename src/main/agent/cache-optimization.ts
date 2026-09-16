import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

// Pi appends the working directory after its Skill list. Keep the application
// project context there too, so shared instructions and matching Skill lists
// remain an identical prefix across projects.
export function appendProjectContext(
  systemPrompt: string,
  projectPath: string,
): string {
  const context = `当前对话所属项目目录（JSON 字符串）：${JSON.stringify(projectPath)}`
  return systemPrompt.endsWith(`\n\n${context}`)
    ? systemPrompt
    : `${systemPrompt}\n\n${context}`
}

export function createCacheOptimizationExtension(
  projectPath: string,
): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', (event) => ({
      systemPrompt: appendProjectContext(event.systemPrompt, projectPath),
    }))
  }
}
