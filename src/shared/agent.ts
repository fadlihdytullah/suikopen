export type AgentProviderId = 'claude' | 'codex' | 'gemini'

export type AgentProvider = { id: AgentProviderId; name: string; command: string; login: string; logout?: string; install: string }

export type AgentProviderStatus = { executable: string | null; signedIn: boolean | null; version?: string; account?: string }

export type AgentTestResult = { ok: boolean; message: string }

export type AgentEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

export type AgentModelOption = { value: string; name: string; description: string; efforts?: AgentEffort[] }

export type AgentSkill = { name: string; description: string }

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
}

export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'done'; sessionId: string | null; costUsd: number | null; error: string | null; signIn?: boolean }

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
