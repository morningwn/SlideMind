import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AgentConfigStore } from './config-store'
import type { BaseAgentService } from './base-agent'

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender)) {
    throw new Error('拒绝来自未知窗口的请求')
  }
}

export function registerAgentIpc(configStore: AgentConfigStore, agentService: BaseAgentService): void {
  ipcMain.handle('agent:get-config', (event) => {
    assertTrustedRenderer(event)
    return configStore.getStatus()
  })

  ipcMain.handle('agent:save-config', async (event, input: unknown) => {
    assertTrustedRenderer(event)
    const status = await configStore.save(input)
    agentService.reset()
    return status
  })

  ipcMain.handle('agent:list-skills', (event, projectHandle: unknown) => {
    assertTrustedRenderer(event)
    return agentService.listSkills(projectHandle)
  })

  ipcMain.handle('agent:get-todos', (event, input: unknown) => {
    assertTrustedRenderer(event)
    return agentService.getTodos(input)
  })

  ipcMain.handle('agent:prompt', (event, input: unknown) => {
    assertTrustedRenderer(event)
    return agentService.prompt(
      input,
      (prompt, delta) => {
        if (event.sender.isDestroyed()) return
        event.sender.send('agent:stream', {
          requestId: prompt.requestId,
          conversationId: prompt.conversationId,
          delta
        })
      },
      (prompt, todos) => {
        if (event.sender.isDestroyed()) return
        event.sender.send('agent:todos', {
          requestId: prompt.requestId,
          conversationId: prompt.conversationId,
          todos
        })
      },
      (activityEvent) => {
        if (event.sender.isDestroyed()) return
        event.sender.send('agent:activity', activityEvent)
      }
    )
  })
}
