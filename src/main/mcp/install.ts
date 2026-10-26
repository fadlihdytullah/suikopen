import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { MCP_PATH, MCP_PORT } from './server'

export const SERVER_KEY = 'suikopen'

export function claudeConfigPath(): string {
  return join(homedir(), '.claude.json')
}

export function serverEntry(port = MCP_PORT): { type: 'http'; url: string } {
  return { type: 'http', url: `http://127.0.0.1:${port}${MCP_PATH}` }
}

export type InstallResult = { changed: boolean; path: string; reason: string }

export async function installIntoClaudeCode(path = claudeConfigPath(), port = MCP_PORT): Promise<InstallResult> {
  let config: Record<string, unknown> = {}
  let existed = false

  try {
    config = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    existed = true
  } catch {
    config = {}
  }

  const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>
  const wanted = serverEntry(port)
  const current = servers[SERVER_KEY]

  if (JSON.stringify(current) === JSON.stringify(wanted)) {
    return { changed: false, path, reason: 'already installed' }
  }

  if (existed) {
    await writeFile(`${path}.suikopen-backup`, JSON.stringify(config, null, 2), 'utf8')
  }

  config['mcpServers'] = { ...servers, [SERVER_KEY]: wanted }
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

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
  } catch {
    return null
  }
}

function codexSection(text: string): string | null {
  const start = text.search(new RegExp(`^\\[mcp_servers\\.${SERVER_KEY}\\]\\s*$`, 'm'))
  if (start < 0) return null
  const rest = text.slice(start)
  const next = rest.slice(1).search(/^\[/m)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

export async function installIntoCodex(path = codexConfigPath(), port = MCP_PORT): Promise<InstallResult> {
  const text = (await readText(path)) ?? ''
  const url = serverEntry(port).url
  const block = `[mcp_servers.${SERVER_KEY}]\nurl = "${url}"\n`
  const section = codexSection(text)
  if (section?.includes(`url = "${url}"`)) {
    return { changed: false, path, reason: 'already installed' }
  }
  if (text) {
    await writeFile(`${path}.suikopen-backup`, text, 'utf8')
  }
  await mkdir(dirname(path), { recursive: true })
  const next = section ? text.replace(section, `${block}\n`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}`
  await writeFile(path, next, 'utf8')
  return { changed: true, path, reason: section ? 'updated existing entry' : 'added entry' }
}

export async function installIntoGemini(path = geminiConfigPath(), port = MCP_PORT): Promise<InstallResult> {
  const text = await readText(path)
  let config: Record<string, unknown> = {}
  if (text) {
    config = JSON.parse(text) as Record<string, unknown>
  }
  const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>
  const wanted = { httpUrl: serverEntry(port).url }
  if (JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(wanted)) {
    return { changed: false, path, reason: 'already installed' }
  }
  if (text) {
    await writeFile(`${path}.suikopen-backup`, text, 'utf8')
  }
  await mkdir(dirname(path), { recursive: true })
  config['mcpServers'] = { ...servers, [SERVER_KEY]: wanted }
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return { changed: true, path, reason: servers[SERVER_KEY] ? 'updated existing entry' : 'added entry' }
}

export async function mcpStatus(client: McpClient, port = MCP_PORT): Promise<McpClientStatus> {
  const url = serverEntry(port).url
  if (client === 'codex') {
    const path = codexConfigPath()
    return { path, installed: !!codexSection((await readText(path)) ?? '')?.includes(`url = "${url}"`) }
  }
  const path = client === 'claude' ? claudeConfigPath() : geminiConfigPath()
  try {
    const servers = (JSON.parse((await readText(path)) ?? '{}') as { mcpServers?: Record<string, { url?: string; httpUrl?: string }> }).mcpServers
    const entry = servers?.[SERVER_KEY]
    return { path, installed: (entry?.url ?? entry?.httpUrl) === url }
  } catch {
    return { path, installed: false }
  }
}

export function installMcp(client: McpClient): Promise<InstallResult> {
  return client === 'claude' ? installIntoClaudeCode() : client === 'codex' ? installIntoCodex() : installIntoGemini()
}
