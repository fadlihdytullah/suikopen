import type { ChatEntry } from './agent'
import type { MemoryNote } from './schema/memory'

const EDIT_TOOLS = new Set(['create_node', 'update_node', 'move_node', 'set_text', 'delete_nodes', 'detach_instance'])

export function touchedIds(tool: string, input: unknown): string[] {
  const params = (input ?? {}) as Record<string, unknown>
  if (tool === 'batch') {
    const ops = Array.isArray(params['ops']) ? params['ops'] : []
    return [...new Set(ops.flatMap((op) => touchedIds(String((op as { tool?: unknown })?.tool ?? ''), op)))]
  }
  if (!EDIT_TOOLS.has(tool)) return []
  const ids: unknown[] = []
  if (tool === 'create_node') ids.push((params['node'] as { id?: unknown } | undefined)?.id)
  ids.push(params['id'])
  if (Array.isArray(params['ids'])) ids.push(...params['ids'])
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

export type ChangedNode = { id: string; name: string; type: string; screen: { id: string; name: string } | null }

export type HandoffInput = {
  tab: { id: string; name: string }
  path: string | null
  entries: readonly ChatEntry[]
  summary: string | null
  memory: readonly MemoryNote[]
  changed: readonly ChangedNode[]
  missing: readonly string[]
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function changedIds(entries: readonly ChatEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => (entry.kind === 'tools' ? (entry.ids ?? []) : [])))]
}

export function buildHandoff(input: HandoffInput): string {
  const asks = input.entries.flatMap((entry) => (entry.kind === 'user' && entry.text.trim() ? [entry.text.trim()] : [])).slice(-6)
  const lastReply = [...input.entries].reverse().find((entry) => entry.kind === 'assistant')
  const summary = input.summary ?? (lastReply && 'text' in lastReply ? lastReply.text : null)

  const screens = new Map<string, { name: string; nodes: ChangedNode[] }>()
  for (const node of input.changed) {
    const key = node.screen?.id ?? node.id
    const group = screens.get(key) ?? { name: node.screen?.name ?? node.name, nodes: [] }
    group.nodes.push(node)
    screens.set(key, group)
  }

  const lines = [
    `# Design handoff — ${input.tab.name}`,
    '',
    `File: ${input.path ?? 'Untitled (not saved yet)'} · SuikoPen tab \`${input.tab.id}\``,
  ]
  if (asks.length) {
    lines.push('', '## What was asked', 'Oldest first. A later ask replaces an earlier one (a rename, a changed decision); the design as it is now is the final result.', ...asks.map((ask) => `- ${clip(ask.replace(/\s+/g, ' '), 300)}`))
  }
  if (summary) {
    lines.push('', '## Result', clip(summary.trim(), 2000))
  }
  if (input.memory.length) {
    lines.push('', '## Decisions and conventions', ...input.memory.map((note) => `- [${note.kind}${note.key ? ` · ${note.key}` : ''}] ${note.text}`))
  }
  if (screens.size || input.missing.length) {
    lines.push('', '## Changed in the design')
    for (const [id, group] of screens) {
      const inner = group.nodes.filter((node) => node.id !== id)
      const listed = inner.slice(0, 12).map((node) => `\`${node.id}\``).join(', ')
      const more = inner.length > 12 ? ` and ${inner.length - 12} more` : ''
      lines.push(`- Screen "${group.name}" (\`${id}\`)${inner.length ? `: ${listed}${more}` : ''}`)
    }
    if (input.missing.length) {
      lines.push(`- Removed: ${input.missing.slice(0, 20).map((id) => `\`${id}\``).join(', ')}`)
    }
  }
  lines.push(
    '',
    '## How to read the design',
    `SuikoPen must be open with this file. Use its MCP server (suikopen) and pass tabId "${input.tab.id}" to every tool; if that tab was closed, call list_tabs and pick the tab with this file. Call get_handoff for the latest version of this note, screenshot and get_node on the ids above, get_variables for design tokens, and export_code for an HTML starting point. Adapt it to this project's framework and components; do not paste the HTML as is.`
  )
  return lines.join('\n')
}
