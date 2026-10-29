import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { AgentEvent, AgentRunRequest } from '../../shared/agent'
import { MCP_PATH, MCP_PORT } from '../mcp/server'
import { DESIGNER_PROMPT } from './prompt'
import { skillInstructions } from './skills'
import { asData, memoryBlock, MemorySchema } from '../../shared/schema/memory'

export type RunResult = { sessionId: string | null; costUsd: number | null; error: string | null; contextTokens?: number | null }

const AUTH_ERROR = /\b401\b|unauthori[sz]ed|not (logged|signed) in|log ?in again|sign ?in again|token (has )?expired|refresh token|invalid_grant|authentication/i

export function cleanError(message: string): string {
  return [...message.matchAll(/\\*"message\\*"\s*:\s*\\*"([^"\\]+)/g)].pop()?.[1] ?? message
}

export function needsSignIn(message: string): boolean {
  return AUTH_ERROR.test(message)
}

export type ProviderRun = (request: AgentRunRequest, signal: AbortSignal, emit: (event: AgentEvent) => void) => Promise<RunResult>

export const MCP_URL = `http://127.0.0.1:${MCP_PORT}${MCP_PATH}`

const SEARCH_DIRS = [join(homedir(), '.local/bin'), join(homedir(), '.claude/local'), '/opt/homebrew/bin', '/usr/local/bin']

export function findExecutable(command: string): string | undefined {
  const directories = [...(process.env['PATH'] ?? '').split(':'), ...SEARCH_DIRS]
  return directories.map((directory) => directory && join(directory, command)).find((candidate) => candidate && existsSync(candidate)) || undefined
}

export function runCommand(executable: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) =>
    execFile(executable, args, { env: childEnvironment(), timeout: 10_000 }, (error, stdout, stderr) =>
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() })
    )
  )
}

export async function commandVersion(executable: string): Promise<string | undefined> {
  const { output } = await runCommand(executable, ['--version'])
  return /\d+\.\d+\.\d+[\w.-]*/.exec(output)?.[0]
}

export function childEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
      env[key] = value
    }
  }
  const extra = SEARCH_DIRS.filter((directory) => !env['PATH']?.split(':').includes(directory))
  env['PATH'] = [env['PATH'], ...extra].filter(Boolean).join(':')
  return env
}

export async function workspace(name: string): Promise<string> {
  const directory = join(app.getPath('userData'), name)
  await mkdir(directory, { recursive: true })
  return directory
}

export function mcpUrl(tab?: { id: string }): string {
  return tab ? `${MCP_URL}?tab=${encodeURIComponent(tab.id)}` : MCP_URL
}

function tabNote(tab?: { id: string; name: string }): string {
  return tab
    ? `\n\nYou are editing "${tab.name}" (tab ${tab.id}). Every suikopen tool works on this tab unless you pass another tabId. Call list_tabs to see the other open files.`
    : ''
}

export const HANDOFF_LIMIT = 6_000

function handoffNote(handoff?: string): string {
  return handoff
    ? `\n\nThis chat was compacted. Summary of the earlier conversation, written by you:\n<handoff>\n${asData(handoff.slice(0, HANDOFF_LIMIT))}\n</handoff>`
    : ''
}

export function contextNotes(request: Pick<AgentRunRequest, 'memory' | 'handoff'>): string {
  const parsed = MemorySchema.safeParse(request.memory ?? [])
  const block = parsed.success ? memoryBlock(parsed.data) : ''
  return `${block ? `\n\n${block}` : ''}${handoffNote(request.handoff)}`
}

export async function systemPrompt(request: Pick<AgentRunRequest, 'skills' | 'tab' | 'memory' | 'handoff'>): Promise<string> {
  const text = request.skills.length ? await skillInstructions(request.skills) : ''
  const base = `${DESIGNER_PROMPT}${tabNote(request.tab)}${contextNotes(request)}`
  return text ? `${base}\n\nThe user attached these skills. Follow them where they apply to this request:\n\n${text}` : base
}
