export type AgentRequest = { id: string; method: string; params: Record<string, unknown> }
export type AgentResponse = { id: string; ok: true; value: unknown } | { id: string; ok: false; error: string }

export type NodeSummary = {
  id: string
  type: string
  name?: string
  parentId: string | null
  depth: number
  rect: { x: number; y: number; width: number; height: number }
  childIds?: string[]
}
