import { query, type EffortLevel, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_MODEL, type AgentModelOption, type AgentRunRequest } from '../../shared/agent'
import { promptWithText, readBase64 } from './attachments'
import { MCP_SERVER_NAME, TOOL_NAMES } from '../mcp/server'
import { mcpToken } from '../mcp/token'
import { childEnvironment, findExecutable, MCP_URL, runCommand, systemPrompt, workspace, type ProviderRun } from './process'

const WEB_TOOLS = ['WebSearch']

const PLANS: Record<string, string> = { pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise' }

export async function claudeAccount(executable: string): Promise<{ signedIn: boolean | null; account?: string }> {
  const { output } = await runCommand(executable, ['auth', 'status', '--json'])
  try {
    const status = JSON.parse(output) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string; subscriptionType?: string }
    if (!status.loggedIn) {
      return { signedIn: false }
    }
    const plan = status.subscriptionType ? PLANS[status.subscriptionType] : undefined
    const account = plan ? `${plan} subscription` : status.apiProvider && status.apiProvider !== 'firstParty' ? status.apiProvider : status.authMethod === 'claude.ai' ? 'Claude account' : 'API key'
    return { signedIn: true, account }
  } catch {
    return { signedIn: null }
  }
}

export async function listClaudeModels(): Promise<AgentModelOption[]> {
  const controller = new AbortController()
  const executable = findExecutable('claude')
  const run = query({
    prompt: (async function* () {
      await new Promise((resolve) => controller.signal.addEventListener('abort', resolve))
    })(),
    options: {
      abortController: controller,
      env: childEnvironment(),
      settingSources: [],
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    },
  })
  try {
    const found = await run.supportedModels()
    return found.map((model) => ({
      value: model.value,
      name: model.displayName,
      description: model.description,
      ...(model.supportsEffort && model.supportedEffortLevels?.length ? { efforts: model.supportedEffortLevels } : {}),
    }))
  } finally {
    controller.abort()
  }
}

async function claudePrompt(request: AgentRunRequest): Promise<string | AsyncIterable<SDKUserMessage>> {
  const text = await promptWithText(request.prompt, request.attachments)
  const media = request.attachments.filter((entry) => entry.kind === 'image' || entry.kind === 'pdf')
  if (media.length === 0) return text
  const blocks = await Promise.all(
    media.map(async (entry) =>
      entry.kind === 'pdf'
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: await readBase64(entry) } }
        : {
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: entry.mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: await readBase64(entry) },
          }
    )
  )
  const message: SDKUserMessage = { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [...blocks, { type: 'text', text }] } }
  return (async function* () {
    yield message
  })()
}

export const runClaude: ProviderRun = async (request, signal, emit) => {
  const controller = new AbortController()
  signal.addEventListener('abort', () => controller.abort())
  const executable = findExecutable('claude')

  const run = query({
    prompt: await claudePrompt(request),
    options: {
      abortController: controller,
      cwd: await workspace('agent'),
      env: childEnvironment(),
      settingSources: [],
      tools: WEB_TOOLS,
      permissionMode: 'dontAsk',
      allowedTools: [...WEB_TOOLS, ...TOOL_NAMES.map((name) => `mcp__${MCP_SERVER_NAME}__${name}`)],
      mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: MCP_URL, headers: { Authorization: `Bearer ${await mcpToken()}` } } },
      systemPrompt: await systemPrompt(request.skills),
      includePartialMessages: true,
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      ...(request.model === DEFAULT_MODEL ? {} : { model: request.model }),
      ...(request.effort ? { effort: request.effort as EffortLevel } : {}),
      ...(request.sessionId ? { resume: request.sessionId } : {}),
    },
  })

  let sessionId = request.sessionId
  let costUsd: number | null = null
  let error: string | null = null

  for await (const message of run) {
    if ('session_id' in message && typeof message.session_id === 'string') {
      sessionId = message.session_id
    }

    if (message.type === 'stream_event') {
      const event = message.event
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        emit({ kind: 'text', text: event.delta.text })
      }
      continue
    }

    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          emit({ kind: 'tool', name: block.name.replace(`mcp__${MCP_SERVER_NAME}__`, ''), input: block.input })
        }
      }
      continue
    }

    if (message.type === 'result') {
      costUsd = message.total_cost_usd
      if (message.subtype !== 'success') {
        error = `Stopped: ${message.subtype.replaceAll('_', ' ')}.`
      } else if (message.is_error) {
        error = message.result
      }
    }
  }

  return { sessionId, costUsd, error }
}
