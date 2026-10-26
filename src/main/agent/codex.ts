import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelReasoningEffort, UserInput } from '@openai/codex-sdk'
import { promptWithText } from './attachments'
import { DEFAULT_MODEL, FALLBACK_MODELS, isEffort, type AgentModelOption } from '../../shared/agent'
import { MCP_SERVER_NAME } from '../mcp/server'
import { childEnvironment, cleanError, findExecutable, MCP_URL, runCommand, systemPrompt, workspace, type ProviderRun } from './process'

type CachedModel = {
  slug: string
  display_name?: string
  description?: string
  visibility?: string
  priority?: number
  supported_reasoning_levels?: { effort: string }[]
}

async function cachedModels(): Promise<CachedModel[]> {
  const cache = JSON.parse(await readFile(join(homedir(), '.codex/models_cache.json'), 'utf8')) as { models?: CachedModel[] }
  return (cache.models ?? []).filter((model) => model.visibility !== 'hide').sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
}

export async function listCodexModels(): Promise<AgentModelOption[]> {
  const listed = await cachedModels()
  return [
    ...FALLBACK_MODELS.codex,
    ...listed.map((model) => {
      const efforts = (model.supported_reasoning_levels ?? []).map((level) => level.effort).filter(isEffort)
      return {
        value: model.slug,
        name: model.display_name ?? model.slug,
        description: model.description ?? '',
        ...(efforts.length ? { efforts } : {}),
      }
    }),
  ]
}

export async function codexAccount(executable: string): Promise<{ signedIn: boolean; account?: string }> {
  const { ok, output } = await runCommand(executable, ['login', 'status'])
  if (!ok) {
    return { signedIn: false }
  }
  return { signedIn: true, account: /chatgpt/i.test(output) ? 'ChatGPT account' : /api key/i.test(output) ? 'API key' : undefined }
}

export function codexError(message: string): string {
  const text = cleanError(message)
  return /model is not supported when using Codex with a ChatGPT account/i.test(text) ? `${text} Pick another model.` : text
}

export const runCodex: ProviderRun = async (request, signal, emit) => {
  const { Codex } = await import('@openai/codex-sdk')
  const executable = findExecutable('codex')
  const codex = new Codex({
    env: childEnvironment(),
    ...(executable ? { codexPathOverride: executable } : {}),
    config: {
      developer_instructions: await systemPrompt(request.skills),
      mcp_servers: {
        [MCP_SERVER_NAME]: {
          url: MCP_URL,
          default_tools_approval_mode: 'approve',
          startup_timeout_sec: 30,
          tool_timeout_sec: 300,
        },
      },
    },
  })
  const model = request.model === DEFAULT_MODEL ? (await cachedModels().catch(() => []))[0]?.slug : request.model
  const options = {
    skipGitRepoCheck: true,
    workingDirectory: await workspace('agent-codex'),
    sandboxMode: 'read-only' as const,
    approvalPolicy: 'never' as const,
    webSearchEnabled: true,
    ...(model ? { model } : {}),
    ...(request.effort ? { modelReasoningEffort: request.effort as ModelReasoningEffort } : {}),
  }
  const thread = request.sessionId ? codex.resumeThread(request.sessionId, options) : codex.startThread(options)
  const text = await promptWithText(request.prompt, request.attachments)
  const images: UserInput[] = request.attachments.filter((entry) => entry.kind === 'image').map((entry) => ({ type: 'local_image', path: entry.path }))
  const { events } = await thread.runStreamed(images.length ? [{ type: 'text', text }, ...images] : text, { signal })

  let sessionId = request.sessionId
  let error: string | null = null
  let afterText = false

  try {
    for await (const event of events) {
      if (event.type === 'thread.started') {
        sessionId = event.thread_id
      } else if (event.type === 'item.started' && event.item.type === 'mcp_tool_call') {
        afterText = false
        emit({
          kind: 'tool',
          name: event.item.tool,
          input: event.item.arguments,
        })
      } else if (event.type === 'item.started' && event.item.type === 'web_search') {
        afterText = false
        emit({
          kind: 'tool',
          name: 'web_search',
          input: { query: event.item.query },
        })
      } else if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        emit({
          kind: 'text',
          text: afterText ? `\n\n${event.item.text}` : event.item.text,
        })
        afterText = true
      } else if (event.type === 'turn.failed') {
        error = codexError(event.error.message)
      } else if (event.type === 'error') {
        error = codexError(event.message)
      }
    }
  } catch (caught) {
    if (!error) {
      throw caught
    }
  }

  return { sessionId, costUsd: null, error }
}
