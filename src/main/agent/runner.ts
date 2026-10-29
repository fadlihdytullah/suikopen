import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FALLBACK_MODELS,
  PROVIDERS,
  type AgentEvent,
  type AgentModelOption,
  type AgentProviderId,
  type AgentProviderStatus,
  type AgentRunRequest,
  type AgentTestResult,
  type CompactRequest,
  type CompactResult,
  DEFAULT_MODEL,
} from '../../shared/agent'
import { claudeAccount, listClaudeModels, runClaude } from './claude'
import { codexAccount, listCodexModels, runCodex } from './codex'
import { geminiAccount, runGemini } from './gemini'
import { compactPrompt, parseCompaction } from './compact'
import { commandVersion, findExecutable, needsSignIn, type ProviderRun } from './process'

const TEST_TIMEOUT_MS = 60_000

const RUNS: Record<AgentProviderId, ProviderRun> = { claude: runClaude, codex: runCodex, gemini: runGemini }

const MODEL_SOURCES: Partial<Record<AgentProviderId, () => Promise<AgentModelOption[]>>> = { claude: listClaudeModels, codex: listCodexModels }

let active: AbortController | null = null

export function stopAgent(): void {
  active?.abort()
}

const models = new Map<AgentProviderId, Promise<AgentModelOption[]>>()

export function listModels(provider: AgentProviderId): Promise<AgentModelOption[]> {
  const source = MODEL_SOURCES[provider]
  if (!source) {
    return Promise.resolve(FALLBACK_MODELS[provider])
  }
  let cached = models.get(provider)
  if (!cached) {
    cached = source()
      .then((found) => (found.length ? found : FALLBACK_MODELS[provider]))
      .catch(() => {
        models.delete(provider)
        return FALLBACK_MODELS[provider]
      })
    models.set(provider, cached)
  }
  return cached
}

export async function providerStatus(provider: AgentProviderId): Promise<AgentProviderStatus> {
  const definition = PROVIDERS.find((entry) => entry.id === provider)
  const executable = definition ? (findExecutable(definition.command) ?? null) : null
  if (!executable) {
    return { executable, signedIn: null }
  }
  const [version, auth] = await Promise.all([
    commandVersion(executable),
    provider === 'claude' ? claudeAccount(executable) : provider === 'codex' ? codexAccount(executable) : Promise.resolve(geminiAccount()),
  ])
  return { executable, version, ...auth }
}

export async function openSignIn(provider: AgentProviderId, reconnect = false): Promise<void> {
  const definition = PROVIDERS.find((entry) => entry.id === provider)
  if (!definition || process.platform !== 'darwin') {
    return
  }
  const commands = reconnect && definition.logout ? `${definition.logout}\n${definition.login}` : definition.login
  const script = join(tmpdir(), `suikopen-signin-${provider}.command`)
  await writeFile(script, `#!/bin/zsh -l\n${commands}\n`, { mode: 0o755 })
  execFile('open', ['-a', 'Terminal', script])
}

export async function testProvider(provider: AgentProviderId): Promise<AgentTestResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  let reply = ''
  try {
    const result = await RUNS[provider](
      { provider, prompt: 'Reply with just the word OK. Do not call any tools.', attachments: [], sessionId: null, model: DEFAULT_MODEL, effort: null, skills: [] },
      controller.signal,
      (event) => {
        if (event.kind === 'text') reply += event.text
      }
    )
    if (result.error) {
      return { ok: false, message: result.error }
    }
    return reply.trim() ? { ok: true, message: 'Connected. The agent replied.' } : { ok: false, message: 'The agent ran but sent no reply.' }
  } catch (caught) {
    return { ok: false, message: controller.signal.aborted ? 'No reply within 60 seconds.' : (caught as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

export async function runAgent(request: AgentRunRequest, emit: (event: AgentEvent) => void): Promise<void> {
  if (active) {
    emit({ kind: 'done', sessionId: request.sessionId, costUsd: null, error: 'The agent is already working.' })
    return
  }

  const controller = new AbortController()
  active = controller
  let result = { sessionId: request.sessionId, costUsd: null as number | null, error: null as string | null }

  try {
    result = await RUNS[request.provider](request, controller.signal, emit)
  } catch (caught) {
    result.error = (caught as Error).message
  } finally {
    active = null
    const error = controller.signal.aborted ? 'Stopped.' : result.error
    emit({ kind: 'done', ...result, error, ...(error && needsSignIn(error) ? { signIn: true } : {}) })
  }
}

export async function compactChat(request: CompactRequest): Promise<CompactResult> {
  if (active) {
    return { ok: false, error: 'The agent is already working.' }
  }
  const controller = new AbortController()
  active = controller
  let reply = ''
  try {
    const result = await RUNS[request.provider](
      { provider: request.provider, prompt: compactPrompt(request), attachments: [], sessionId: request.sessionId, model: request.model, effort: null, skills: [], ...(request.tab ? { tab: request.tab } : {}) },
      controller.signal,
      (event) => {
        if (event.kind === 'text') reply += event.text
      }
    )
    if (controller.signal.aborted) {
      return { ok: false, error: 'Stopped.' }
    }
    return result.error && !reply ? { ok: false, error: result.error } : parseCompaction(reply)
  } catch (caught) {
    return { ok: false, error: (caught as Error).message }
  } finally {
    active = null
  }
}
