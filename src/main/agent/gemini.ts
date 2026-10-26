import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { promptWithText } from './attachments'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { DEFAULT_MODEL } from '../../shared/agent'
import { MCP_SERVER_NAME } from '../mcp/server'
import { childEnvironment, cleanError, findExecutable, MCP_URL, systemPrompt, workspace, type ProviderRun } from './process'

const BLOCKED_TOOLS = ['run_shell_command', 'write_file', 'replace']

type StreamEvent = {
  type?: string
  session_id?: string
  role?: string
  content?: string
  tool_name?: string
  parameters?: unknown
  severity?: string
  message?: string
  status?: string
  error?: { message?: string }
}

export function geminiAccount(): { signedIn: boolean; account?: string } {
  if (existsSync(join(homedir(), '.gemini/oauth_creds.json'))) {
    return { signedIn: true, account: 'Google account' }
  }
  if (process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY']) {
    return { signedIn: true, account: 'API key' }
  }
  return { signedIn: false }
}

export function geminiToolName(name: string): string {
  return name.replace(new RegExp(`^(mcp_)?${MCP_SERVER_NAME}(__|_)`), '')
}

export const runGemini: ProviderRun = async (request, signal, emit) => {
  const executable = findExecutable('gemini')
  if (!executable) {
    return { sessionId: request.sessionId, costUsd: null, error: "Gemini CLI isn't installed." }
  }

  const cwd = await workspace('agent-gemini')
  await mkdir(join(cwd, '.gemini'), { recursive: true })
  await writeFile(
    join(cwd, '.gemini/settings.json'),
    JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { httpUrl: MCP_URL, trust: true } }, tools: { exclude: BLOCKED_TOOLS } }, null, 2)
  )
  const attachmentDir = join(cwd, 'attachments')
  await rm(attachmentDir, { recursive: true, force: true })
  const references: string[] = []
  for (const [index, entry] of request.attachments.filter((item) => item.kind !== 'text').entries()) {
    await mkdir(attachmentDir, { recursive: true })
    const name = `${index + 1}-${entry.name.replace(/[^\w.-]/g, '_')}`
    await copyFile(entry.path, join(attachmentDir, name))
    references.push(`@attachments/${name}`)
  }
  const prompt = await promptWithText(request.prompt, request.attachments)
  const promptPath = join(cwd, 'system.md')
  await writeFile(promptPath, await systemPrompt(request.skills))

  const args = [
    '--output-format',
    'stream-json',
    '--approval-mode',
    'yolo',
    '--allowed-mcp-server-names',
    MCP_SERVER_NAME,
    ...(request.model === DEFAULT_MODEL ? [] : ['--model', request.model]),
    ...(request.sessionId ? ['--resume', request.sessionId] : []),
    '--prompt',
    references.length ? `${references.join(' ')}\n\n${prompt}` : prompt,
  ]
  const child = spawn(executable, args, { cwd, env: { ...childEnvironment(), GEMINI_SYSTEM_MD: promptPath, GEMINI_CLI_TRUST_WORKSPACE: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const kill = () => child.kill()
  signal.addEventListener('abort', kill)

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000)
  })
  const exited = new Promise<number | null>((resolve) => {
    child.on('close', resolve)
    child.on('error', () => resolve(-1))
  })

  let sessionId = request.sessionId
  let error: string | null = null
  let finished = false

  for await (const line of createInterface({ input: child.stdout })) {
    let event: StreamEvent
    try {
      event = JSON.parse(line) as StreamEvent
    } catch {
      continue
    }
    if (event.type === 'init' && event.session_id) {
      sessionId = event.session_id
    } else if (event.type === 'message' && event.role === 'assistant' && event.content) {
      emit({ kind: 'text', text: event.content })
    } else if (event.type === 'tool_use' && event.tool_name) {
      emit({ kind: 'tool', name: geminiToolName(event.tool_name), input: event.parameters })
    } else if (event.type === 'error' && event.severity !== 'warning') {
      error = cleanError(event.message ?? 'Gemini CLI reported an error.')
    } else if (event.type === 'result') {
      finished = true
      if (event.status !== 'success') {
        error = event.error?.message ? cleanError(event.error.message) : (error ?? 'Gemini CLI stopped.')
      }
    }
  }

  const code = await exited
  signal.removeEventListener('abort', kill)
  if (!finished && !signal.aborted && code !== 0) {
    error ??= stderr.trim().split('\n').pop() || `Gemini CLI exited with code ${code}.`
  }
  return { sessionId, costUsd: null, error }
}
