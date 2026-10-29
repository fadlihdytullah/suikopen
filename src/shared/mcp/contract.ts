export type TabRef = { id: string; name: string }
export type AgentRequest = { id: string; method: string; params: Record<string, unknown>; tabId?: string }
export type AgentReply = { value: unknown; tab?: TabRef }
export type AgentResponse = { id: string; ok: true; value: unknown; tab?: TabRef } | { id: string; ok: false; error: string }
export type TabListing = { id: string; name: string; path: string | null; active: boolean; dirty: boolean; agentBusy: boolean }

export type NodeSummary = {
  id: string
  type: string
  name?: string
  parentId: string | null
  depth: number
  rect: { x: number; y: number; width: number; height: number }
  childIds?: string[]
}
