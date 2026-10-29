import type { MemoryNote } from './schema/memory'

export type AgentProviderId = 'claude' | 'codex' | 'gemini'

export type AgentProvider = { id: AgentProviderId; name: string; command: string; login: string; logout?: string; install: string }

export type AgentProviderStatus = { executable: string | null; signedIn: boolean | null; version?: string; account?: string }

export type AgentTestResult = { ok: boolean; message: string }

export type AgentEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

export type AgentModelOption = { value: string; name: string; description: string; efforts?: AgentEffort[] }

export type AgentSkill = { name: string; description: string; builtIn?: boolean }

export type AgentAttachmentKind = 'image' | 'pdf' | 'text'

export type AgentAttachment = { path: string; name: string; kind: AgentAttachmentKind; mime: string; size: number; thumbnail?: string }

export type AgentAttachmentResult = AgentAttachment | { name: string; error: string }

export type AgentRunRequest = {
  provider: AgentProviderId
  prompt: string
  attachments: AgentAttachment[]
  sessionId: string | null
  model: string
  effort: AgentEffort | null
  skills: string[]
  tab?: { id: string; name: string }
  memory?: MemoryNote[]
  handoff?: string
}

export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'done'; sessionId: string | null; costUsd: number | null; error: string | null; signIn?: boolean; contextTokens?: number | null }

export const DEFAULT_MODEL = 'default'

export const EFFORT_LABELS: Record<AgentEffort, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra',
}

export const PROVIDERS: AgentProvider[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', login: 'claude auth login', logout: 'claude auth logout', install: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex', name: 'Codex', command: 'codex', login: 'codex login', logout: 'codex logout', install: 'npm install -g @openai/codex' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', login: 'gemini', install: 'npm install -g @google/gemini-cli' },
]

export const DEFAULT_PROVIDER: AgentProviderId = 'claude'

export const FALLBACK_MODELS: Record<AgentProviderId, AgentModelOption[]> = {
  claude: [
    { value: DEFAULT_MODEL, name: 'Auto', description: 'Claude Code default' },
    { value: 'opus', name: 'Opus', description: 'Most capable' },
    { value: 'sonnet', name: 'Sonnet', description: 'Balanced' },
    { value: 'haiku', name: 'Haiku', description: 'Fastest' },
  ],
  codex: [{ value: DEFAULT_MODEL, name: 'Auto', description: 'Top model for your account' }],
  gemini: [
    { value: DEFAULT_MODEL, name: 'Auto', description: 'Gemini CLI picks the model' },
    { value: 'pro', name: 'Pro', description: 'Most capable' },
    { value: 'flash', name: 'Flash', description: 'Fast and balanced' },
    { value: 'flash-lite', name: 'Flash Lite', description: 'Fastest' },
  ],
}

export function isEffort(value: unknown): value is AgentEffort {
  return typeof value === 'string' && value in EFFORT_LABELS
}

export const MAX_ATTACHMENTS = 5

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'html', 'htm', 'css', 'svg', 'xml', 'yaml', 'yml', 'toml',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'rb', 'go', 'rs', 'swift', 'kt', 'java', 'php', 'sh', 'sql',
])

export function classifyAttachment(name: string): { kind: AgentAttachmentKind; mime: string } | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_TYPES[extension]) return { kind: 'image', mime: IMAGE_TYPES[extension] }
  if (extension === 'pdf') return { kind: 'pdf', mime: 'application/pdf' }
  if (TEXT_EXTENSIONS.has(extension)) return { kind: 'text', mime: 'text/plain' }
  return null
}

export const ATTACHMENT_SUPPORT: Record<AgentProviderId, AgentAttachmentKind[]> = {
  claude: ['image', 'pdf', 'text'],
  codex: ['image', 'text'],
  gemini: ['image', 'pdf', 'text'],
}

export const ATTACHMENT_HINT = 'Images, PDFs and text files up to 10 MB'

export type LayerRef = { id: string; name: string; type: string; width: number; height: number }

export const LAYER_REF_LIMIT = 50

export function layersBlock(layers: readonly LayerRef[]): string {
  if (layers.length === 0) return ''
  const shown = layers.slice(0, LAYER_REF_LIMIT)
  const lines = shown.map((layer) => `- "${layer.name.replace(/\s+/g, ' ').slice(0, 80)}" (${layer.type}, id ${layer.id}, ${layer.width}×${layer.height})`)
  const more = layers.length > shown.length ? [`- …and ${layers.length - shown.length} more`] : []
  return ['', '', 'Layers the user selected on the canvas when sending this message. "This" and "these" mean them; read details with get_node or screenshot:', ...lines, ...more].join('\n')
}

export type ChatFile = { name: string; kind: AgentAttachmentKind; thumbnail?: string; lines?: number }

export type ChatEntry =
  | { kind: 'user'; text: string; skills: string[]; files: ChatFile[]; layers?: Pick<LayerRef, 'id' | 'name' | 'type'>[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'tools'; names: string[]; ids?: string[] }
  | { kind: 'memory'; text: string }
  | { kind: 'compacted'; handoff: string }
  | { kind: 'error'; text: string; signIn?: AgentProviderId }

export type ChatSummary = {
  id: string
  title: string
  documentPath: string | null
  provider: AgentProviderId
  updatedAt: number
}

export type ChatRecord = ChatSummary & {
  tabId?: string
  model: string
  sessionId: string | null
  createdAt: number
  entries: ChatEntry[]
  handoff?: string
  contextTokens?: number
}

export const CONTEXT_WINDOWS: Record<AgentProviderId, number> = { claude: 200_000, codex: 272_000, gemini: 1_000_000 }

export const COMPACT_AT = 0.75

export function estimateTokens(entries: readonly ChatEntry[]): number {
  let chars = 0
  for (const entry of entries) {
    chars += 'text' in entry ? entry.text.length : 'handoff' in entry ? entry.handoff.length : entry.names.length * 400
  }
  return Math.round(chars / 4)
}

export function shouldCompact(provider: AgentProviderId, contextTokens: number | null | undefined, entries: readonly ChatEntry[]): boolean {
  const used = contextTokens ?? estimateTokens(entries)
  return used >= CONTEXT_WINDOWS[provider] * COMPACT_AT
}

export type CompactRequest = { provider: AgentProviderId; model: string; sessionId: string | null; transcript: string; tab?: { id: string; name: string } }

export type CompactResult = { ok: true; handoff: string; notes: { key?: string; kind?: string; text: string }[] } | { ok: false; error: string }
