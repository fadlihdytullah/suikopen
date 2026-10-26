import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installIntoCodex, installIntoGemini } from '../src/main/mcp/install'

describe('installIntoCodex', () => {
  it('appends a section, keeps other servers, and is idempotent', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'codex-')), 'config.toml')
    await writeFile(path, 'model = "x"\n\n[mcp_servers.pencil]\ncommand = "pen"\n')
    expect((await installIntoCodex(path, 29980)).changed).toBe(true)
    expect((await installIntoCodex(path, 29980)).changed).toBe(false)
    const text = await readFile(path, 'utf8')
    expect(text).toContain('[mcp_servers.pencil]\ncommand = "pen"')
    expect(text).toContain('[mcp_servers.suikopen]\nurl = "http://127.0.0.1:29980/mcp"')
    expect(await readFile(`${path}.suikopen-backup`, 'utf8')).toContain('model = "x"')
  })

  it('updates an existing section in place', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'codex-')), 'config.toml')
    await writeFile(path, '[mcp_servers.suikopen]\nurl = "http://127.0.0.1:1/mcp"\n\n[other]\na = 1\n')
    await installIntoCodex(path, 29980)
    const text = await readFile(path, 'utf8')
    expect(text.match(/mcp_servers\.suikopen/g)).toHaveLength(1)
    expect(text).toContain('url = "http://127.0.0.1:29980/mcp"')
    expect(text).toContain('[other]\na = 1')
  })
})

describe('installIntoGemini', () => {
  it('creates settings with an httpUrl entry', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'gemini-')), '.gemini', 'settings.json')
    await installIntoGemini(path, 29980)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ mcpServers: { suikopen: { httpUrl: 'http://127.0.0.1:29980/mcp' } } })
    expect((await installIntoGemini(path, 29980)).changed).toBe(false)
  })
})

describe('security guards', async () => {
  const { allowedRequest } = await import('../src/main/mcp/server')

  it('accepts only local hosts and origins', () => {
    expect(allowedRequest(undefined, '127.0.0.1:29980', 29980)).toBe(true)
    expect(allowedRequest('http://localhost:5173', 'localhost:29980', 29980)).toBe(true)
    expect(allowedRequest('http://localhost.evil.com', '127.0.0.1:29980', 29980)).toBe(false)
    expect(allowedRequest(undefined, 'evil.com:29980', 29980)).toBe(false)
    expect(allowedRequest('http://127.0.0.1.evil.com', 'localhost:29980', 29980)).toBe(false)
  })
})
