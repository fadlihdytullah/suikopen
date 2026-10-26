import { useEffect, useState } from 'react'
import type { Document } from '../../shared/schema/document'
import type { Asset, DiscardChoice, OpenResult, SaveResult } from '../../main/ipc'
import type { MenuCommand } from '../../main/menu'
import type { AgentRequest } from '../../shared/mcp/contract'
import type { ChatRecord, ChatSummary, AgentAttachmentResult, AgentEvent, AgentModelOption, AgentProviderId, AgentProviderStatus, AgentRunRequest, AgentSkill, AgentTestResult } from '../../shared/agent'

declare global {
  interface Window {
    suikopen: {
      platform: string
      openInitialDocument: () => Promise<OpenResult>
      openDocumentDialog: () => Promise<OpenResult | { cancelled: true }>
      saveDocument: (request: { path: string | null; document: Document; saveAs?: boolean }) => Promise<SaveResult>
      setWindowState: (state: { path: string | null; edited: boolean }) => Promise<void>
      confirmDiscard: () => Promise<DiscardChoice>
      onMenuCommand: (callback: (command: MenuCommand) => void) => () => void
      onCloseRequest: (callback: () => void) => () => void
      allowClose: () => void
      readAsset: (request: { base: string | null; url: string }) => Promise<Asset | null>
      readFont: (request: { family: string; weight?: number; italic?: boolean }) => Promise<ArrayBuffer | null>
      onAgentCall: (handler: (request: AgentRequest) => Promise<unknown>) => () => void
      runAgent: (request: AgentRunRequest) => Promise<void>
      stopAgent: () => Promise<void>
      agentModels: (provider: AgentProviderId) => Promise<AgentModelOption[]>
      agentSkills: () => Promise<AgentSkill[]>
      agentStatus: (provider: AgentProviderId) => Promise<AgentProviderStatus>
      agentSignIn: (provider: AgentProviderId, reconnect?: boolean) => Promise<void>
      agentTest: (provider: AgentProviderId) => Promise<AgentTestResult>
      pathForFile: (file: File) => string
      listChats: (documentPath?: string | null) => Promise<ChatSummary[]>
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
  | { status: 'ready'; document: Document; path: string | null; assetBase: string }
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
        result.ok
          ? { status: 'ready', document: result.document, path: result.path, assetBase: result.assetBase }
          : { status: 'failed', error: result.error }
      )
    })

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
