import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Document } from '../shared/schema/document'
import type { Asset, DiscardChoice, OpenResult, SaveResult } from '../main/ipc'
import type { MenuCommand } from '../main/menu'
import type { AgentRequest, AgentResponse } from '../shared/mcp/contract'
import type { ChatRecord, ChatSummary, AgentAttachmentResult, AgentEvent, AgentModelOption, AgentProviderId, AgentProviderStatus, AgentRunRequest, AgentSkill, AgentTestResult } from '../shared/agent'

contextBridge.exposeInMainWorld('suikopen', {
  platform: process.platform,
  openInitialDocument: (): Promise<OpenResult> => ipcRenderer.invoke('document:open-initial'),
  openDocumentDialog: (): Promise<OpenResult | { cancelled: true }> => ipcRenderer.invoke('document:open-dialog'),
  saveDocument: (request: { path: string | null; document: Document; saveAs?: boolean }): Promise<SaveResult> =>
    ipcRenderer.invoke('document:save', request),
  setWindowState: (state: { path: string | null; edited: boolean }): Promise<void> =>
    ipcRenderer.invoke('window:set-state', state),
  confirmDiscard: (): Promise<DiscardChoice> => ipcRenderer.invoke('app:confirm-discard'),
  onMenuCommand: (callback: (command: MenuCommand) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand): void => callback(command)
    ipcRenderer.on('menu:command', handler)
    return () => ipcRenderer.off('menu:command', handler)
  },
  onCloseRequest: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('app:close-request', handler)
    return () => ipcRenderer.off('app:close-request', handler)
  },
  allowClose: (): void => ipcRenderer.send('app:allow-close'),
  readAsset: (request: { base: string | null; url: string }): Promise<Asset | null> =>
    ipcRenderer.invoke('asset:read', request),
  readFont: (request: { family: string; weight?: number; italic?: boolean }): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('font:read', request),
  runAgent: (request: AgentRunRequest): Promise<void> => ipcRenderer.invoke('agent:run', request),
  stopAgent: (): Promise<void> => ipcRenderer.invoke('agent:stop'),
  agentModels: (provider: AgentProviderId): Promise<AgentModelOption[]> => ipcRenderer.invoke('agent:models', provider),
  agentSkills: (): Promise<AgentSkill[]> => ipcRenderer.invoke('agent:skills'),
  agentStatus: (provider: AgentProviderId): Promise<AgentProviderStatus> => ipcRenderer.invoke('agent:status', provider),
  agentSignIn: (provider: AgentProviderId, reconnect?: boolean): Promise<void> => ipcRenderer.invoke('agent:sign-in', provider, reconnect),
  agentTest: (provider: AgentProviderId): Promise<AgentTestResult> => ipcRenderer.invoke('agent:test', provider),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  listChats: (documentPath?: string | null): Promise<ChatSummary[]> => ipcRenderer.invoke('chats:list', documentPath),
  getChat: (id: string): Promise<ChatRecord | null> => ipcRenderer.invoke('chats:get', id),
  saveChat: (record: ChatRecord): Promise<void> => ipcRenderer.invoke('chats:save', record),
  deleteChat: (id: string): Promise<void> => ipcRenderer.invoke('chats:delete', id),
  mcpStatus: (client: string): Promise<{ installed: boolean; path: string }> => ipcRenderer.invoke('mcp:status', client),
  mcpInstall: (client: string): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('mcp:install', client),
  agentAttach: (paths: string[]): Promise<AgentAttachmentResult[]> => ipcRenderer.invoke('agent:attach', paths),
  agentAttachData: (name: string, data: ArrayBuffer): Promise<AgentAttachmentResult> => ipcRenderer.invoke('agent:attach-data', name, data),
  agentPickAttachments: (): Promise<AgentAttachmentResult[]> => ipcRenderer.invoke('agent:pick-attachments'),
  onAgentEvent: (callback: (event: AgentEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, agentEvent: AgentEvent): void => callback(agentEvent)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.off('agent:event', listener)
  },
  onAgentCall: (handler: (request: AgentRequest) => Promise<unknown>) => {
    const listener = (_event: Electron.IpcRendererEvent, request: AgentRequest): void => {
      handler(request)
        .then((value) => ipcRenderer.send('agent:result', { id: request.id, ok: true, value } satisfies AgentResponse))
        .catch((error: Error) =>
          ipcRenderer.send('agent:result', { id: request.id, ok: false, error: error.message } satisfies AgentResponse)
        )
    }
    ipcRenderer.on('agent:call', listener)
    return () => ipcRenderer.off('agent:call', listener)
  },
})
