import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { MCP_PATH, MCP_PORT } from './server'
import { mcpToken } from './token'

export const SERVER_KEY = 'suikopen'

export function claudeConfigPath(): string {
  return join(homedir(), '.claude.json')
}

export function serverEntry(port = MCP_PORT, token = ''): { type: 'http'; url: string; headers?: Record<string, string> } {
  const url = `http://127.0.0.1:${port}${MCP_PATH}`
  return token ? { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } : { type: 'http', url }
}

export type InstallResult = { changed: boolean; path: string; reason: string }

export async function installIntoClaudeCode(path = claudeConfigPath(), port = MCP_PORT, token = ''): Promise<InstallResult> {
  const text = await readText(path)
  const config = parseConfig(text, path)
  const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>
  const wanted = serverEntry(port, token)
  const current = servers[SERVER_KEY]

  if (JSON.stringify(current) === JSON.stringify(wanted)) {
    return { changed: false, path, reason: 'already installed' }
  }

  if (text) {
    await writeFile(`${path}.suikopen-backup`, text, 'utf8')
  }

  config['mcpServers'] = { ...servers, [SERVER_KEY]: wanted }
  await writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`)

  return { changed: true, path, reason: current ? 'updated existing entry' : 'added entry' }
}

export type McpClient = 'claude' | 'codex' | 'gemini'

export type McpClientStatus = { installed: boolean; path: string }

export function codexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml')
}

export function geminiConfigPath(): string {
  return join(homedir(), '.gemini', 'settings.json')
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function parseConfig(text: string | null, path: string): Record<string, unknown> {
  if (!text) {
    return {}
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`${path} is not valid JSON right now, so it was left untouched. Try again in a moment.`)
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.suikopen-tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

function codexSection(text: string): string | null {
  const start = text.search(new RegExp(`^\\[mcp_servers\\.${SERVER_KEY}\\]\\s*$`, 'm'))
  if (start < 0) return null
  const rest = text.slice(start)
  const next = rest.slice(1).search(/^\[/m)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

function codexBlock(url: string, token: string): string {
  return `[mcp_servers.${SERVER_KEY}]\nurl = "${url}"\n${token ? `http_headers = { Authorization = "Bearer ${token}" }\n` : ''}`
}

export async function installIntoCodex(path = codexConfigPath(), port = MCP_PORT, token = ''): Promise<InstallResult> {
  const text = (await readText(path)) ?? ''
  const url = serverEntry(port).url
  const block = codexBlock(url, token)
  const section = codexSection(text)
  if (section?.trim() === block.trim()) {
    return { changed: false, path, reason: 'already installed' }
  }
  if (text) {
    await writeFile(`${path}.suikopen-backup`, text, 'utf8')
  }
  const next = section ? text.replace(section, `${block}\n`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}`
  await writeAtomic(path, next)
  return { changed: true, path, reason: section ? 'updated existing entry' : 'added entry' }
}

export async function installIntoGemini(path = geminiConfigPath(), port = MCP_PORT, token = ''): Promise<InstallResult> {
  const text = await readText(path)
  const config = parseConfig(text, path)
  const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>
  const { url, headers } = serverEntry(port, token)
  const wanted = headers ? { httpUrl: url, headers } : { httpUrl: url }
  if (JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(wanted)) {
    return { changed: false, path, reason: 'already installed' }
  }
  if (text) {
    await writeFile(`${path}.suikopen-backup`, text, 'utf8')
  }
  config['mcpServers'] = { ...servers, [SERVER_KEY]: wanted }
  await writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`)
  return { changed: true, path, reason: servers[SERVER_KEY] ? 'updated existing entry' : 'added entry' }
}

export async function mcpStatus(client: McpClient, port = MCP_PORT, token?: string): Promise<McpClientStatus> {
  const secret = token ?? (await mcpToken())
  const { url, headers } = serverEntry(port, secret)
  if (client === 'codex') {
    const path = codexConfigPath()
    return { path, installed: codexSection((await readText(path).catch(() => null)) ?? '')?.trim() === codexBlock(url, secret).trim() }
  }
  const path = client === 'claude' ? claudeConfigPath() : geminiConfigPath()
  try {
    const servers = (JSON.parse((await readText(path).catch(() => null)) ?? '{}') as {
      mcpServers?: Record<string, { url?: string; httpUrl?: string; headers?: Record<string, string> }>
    }).mcpServers
    const entry = servers?.[SERVER_KEY]
    return { path, installed: (entry?.url ?? entry?.httpUrl) === url && entry?.headers?.['Authorization'] === headers?.['Authorization'] }
  } catch {
    return { path, installed: false }
  }
}

export async function installMcp(client: McpClient): Promise<InstallResult> {
  const token = await mcpToken()
  return client === 'claude'
    ? installIntoClaudeCode(claudeConfigPath(), MCP_PORT, token)
    : client === 'codex'
      ? installIntoCodex(codexConfigPath(), MCP_PORT, token)
      : installIntoGemini(geminiConfigPath(), MCP_PORT, token)
}
