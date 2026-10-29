import type { CompactRequest, CompactResult } from '../../shared/agent'
import { asData, MEMORY_KINDS, MEMORY_LIMITS } from '../../shared/schema/memory'

export const TRANSCRIPT_LIMIT = 60_000

const INSTRUCTIONS = `Compact this conversation so it can continue in a fresh session. Do not call any tools. Reply with one JSON object and nothing else:
{"handoff": "...", "notes": [{"key": "...", "kind": "brand|decision|convention|note", "text": "..."}]}
handoff: under 400 words. What the user wants, what was built (screen and node ids), what is still open, and the next step. Plain text.
notes: only lasting facts about this design that later sessions must keep (brand colours and fonts, decisions the user made, naming or component conventions). Each under ${MEMORY_LIMITS.text} characters with a stable key such as "brand.primary". Empty array if none. Never progress, chat or secrets.`

export function compactPrompt(request: Pick<CompactRequest, 'sessionId' | 'transcript'>): string {
  return request.sessionId
    ? INSTRUCTIONS
    : `${INSTRUCTIONS}\n\nConversation so far:\n<transcript>\n${asData(request.transcript.slice(-TRANSCRIPT_LIMIT))}\n</transcript>`
}

export function parseCompaction(reply: string): CompactResult {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { ok: false, error: 'The agent did not return a summary.' }
  }
  let value: unknown
  try {
    value = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return { ok: false, error: 'The agent returned a summary that could not be read.' }
  }
  const { handoff, notes } = value as { handoff?: unknown; notes?: unknown }
  if (typeof handoff !== 'string' || !handoff.trim()) {
    return { ok: false, error: 'The agent returned an empty summary.' }
  }
  const kinds = new Set<string>(MEMORY_KINDS)
  const clean = (Array.isArray(notes) ? notes : []).flatMap((note) => {
    const { key, kind, text } = (note ?? {}) as Record<string, unknown>
    if (typeof text !== 'string' || !text.trim()) return []
    return [{
      text: text.trim().slice(0, MEMORY_LIMITS.text),
      ...(typeof key === 'string' && key.trim() ? { key: key.trim().slice(0, MEMORY_LIMITS.key) } : {}),
      ...(typeof kind === 'string' && kinds.has(kind) ? { kind } : {}),
    }]
  })
  return { ok: true, handoff: handoff.trim(), notes: clean.slice(0, MEMORY_LIMITS.notes) }
}
