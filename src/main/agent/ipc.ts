import { dialog, ipcMain } from 'electron'
import { describeAttachment, savePasted } from './attachments'
import { deleteChat, getChat, listChats, saveChat } from './chats'
import { installMcp, mcpStatus, type McpClient } from '../mcp/install'
import type { AgentProviderId, AgentRunRequest, ChatRecord, CompactRequest } from '../../shared/agent'
import { compactChat, listModels, openSignIn, providerStatus, runAgent, stopAgent, testProvider } from './runner'
import { listSkills } from './skills'

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:run', (event, request: AgentRunRequest) => {
    void runAgent(request, (agentEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('agent:event', agentEvent)
      }
    })
  })

  ipcMain.handle('agent:stop', () => stopAgent())

  ipcMain.handle('agent:compact', (_event, request: CompactRequest) => compactChat(request))

  ipcMain.handle('agent:models', (_event, provider: AgentProviderId) => listModels(provider))

  ipcMain.handle('agent:skills', () => listSkills())

  ipcMain.handle('agent:status', (_event, provider: AgentProviderId) => providerStatus(provider))

  ipcMain.handle('agent:sign-in', (_event, provider: AgentProviderId, reconnect?: boolean) => openSignIn(provider, reconnect))

  ipcMain.handle('agent:attach', (_event, paths: string[]) => Promise.all(paths.map(describeAttachment)))

  ipcMain.handle('agent:attach-data', (_event, name: string, data: ArrayBuffer) => savePasted(name, data))

  ipcMain.handle('agent:pick-attachments', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images, PDFs and text', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'json', 'csv', 'html', 'css', 'svg', 'xml', 'yaml', 'yml', 'js', 'ts', 'tsx', 'jsx'] }],
    })
    return result.canceled ? [] : Promise.all(result.filePaths.map(describeAttachment))
  })

  ipcMain.handle('chats:list', (_event, documentPath?: string | null, tabId?: string) => listChats(documentPath, tabId))

  ipcMain.handle('chats:get', (_event, id: string) => getChat(id))

  ipcMain.handle('chats:save', (_event, record: ChatRecord) => saveChat(record))

  ipcMain.handle('chats:delete', (_event, id: string) => deleteChat(id))

  ipcMain.handle('mcp:status', (_event, client: McpClient) => mcpStatus(client))

  ipcMain.handle('mcp:install', async (_event, client: McpClient) => {
    try {
      await installMcp(client)
      return { ok: true, message: 'Connected.' }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  })

  ipcMain.handle('agent:test', (_event, provider: AgentProviderId) => testProvider(provider))
}
