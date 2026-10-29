import { useEffect, useState } from 'react'
import type { Document } from '../../shared/schema/document'
import type { Asset, DiscardChoice, InitialResult, OpenedDocument, OpenResult, SaveResult } from '../../main/ipc'
import type { MenuCommand } from '../../main/menu'
import type { AgentReply, AgentRequest } from '../../shared/mcp/contract'
import type { ChatRecord, ChatSummary, AgentAttachmentResult, AgentEvent, AgentModelOption, AgentProviderId, AgentProviderStatus, AgentRunRequest, AgentSkill, AgentTestResult, CompactRequest, CompactResult } from '../../shared/agent'

declare global {
  interface Window {
    suikopen: {
      platform: string
      openInitialDocument: () => Promise<InitialResult>
      openDocumentDialog: () => Promise<OpenResult | { cancelled: true }>
      saveDocument: (request: { tabId?: string; path: string | null; document: Document; saveAs?: boolean }) => Promise<SaveResult>
      setWindowState: (state: { path: string | null; edited: boolean }) => Promise<void>
      checkpoint: (state: { tabId: string; document: Document; path: string | null; assetBase: string | null; dirty: boolean }) => void
      confirmDiscard: (name?: string) => Promise<DiscardChoice>
      newTabId: () => Promise<string>
      confirmStopAgent: (name: string) => Promise<boolean>
      tabClosed: (id: string) => void
      spillHistory: (id: string, json: string) => Promise<void>
      takeHistory: (id: string) => Promise<string | null>
      syncTabs: (list: { id: string; name: string; active: boolean }[]) => void
      onTabActivate: (callback: (id: string) => void) => () => void
      onMenuCommand: (callback: (command: MenuCommand) => void) => () => void
      onDocumentOpened: (callback: (result: OpenResult) => void) => () => void
      onCloseRequest: (callback: () => void) => () => void
      allowClose: () => void
      reportError: (message: string, fatal?: boolean) => void
      readAsset: (request: { base: string | null; url: string }) => Promise<Asset | null>
      readFont: (request: { family: string; weight?: number; italic?: boolean }) => Promise<ArrayBuffer | null>
      onAgentCall: (handler: (request: AgentRequest) => Promise<AgentReply>) => () => void
      runAgent: (request: AgentRunRequest) => Promise<void>
      stopAgent: () => Promise<void>
      compactChat: (request: CompactRequest) => Promise<CompactResult>
      agentModels: (provider: AgentProviderId) => Promise<AgentModelOption[]>
      agentSkills: () => Promise<AgentSkill[]>
      agentStatus: (provider: AgentProviderId) => Promise<AgentProviderStatus>
      agentSignIn: (provider: AgentProviderId, reconnect?: boolean) => Promise<void>
      agentTest: (provider: AgentProviderId) => Promise<AgentTestResult>
      pathForFile: (file: File) => string
      listChats: (documentPath?: string | null, tabId?: string) => Promise<ChatSummary[]>
      getChat: (id: string) => Promise<ChatRecord | null>
      saveChat: (record: ChatRecord) => Promise<void>
      deleteChat: (id: string) => Promise<void>
      mcpStatus: (client: string) => Promise<{ installed: boolean; path: string }>
      mcpInstall: (client: string) => Promise<{ ok: boolean; message: string }>
      agentAttach: (paths: string[]) => Promise<AgentAttachmentResult[]>
      agentAttachData: (name: string, data: ArrayBuffer) => Promise<AgentAttachmentResult>
      agentPickAttachments: () => Promise<AgentAttachmentResult[]>
      onAgentEvent: (callback: (event: AgentEvent) => void) => () => void
    }
  }
}

export type DocumentState =
  | { status: 'loading' }
  | { status: 'ready'; opened: OpenedDocument[]; activeTabId: string | null }
  | { status: 'failed'; error: string }

export function useInitialDocument(): DocumentState {
  const [state, setState] = useState<DocumentState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    window.suikopen.openInitialDocument().then((result) => {
      if (cancelled) {
        return
      }
      setState(
        result.ok ? { status: 'ready', opened: result.tabs, activeTabId: result.activeTabId } : { status: 'failed', error: result.error }
      )
    })

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
