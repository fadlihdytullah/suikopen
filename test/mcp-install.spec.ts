import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

describe('installSkill', async () => {
  const { installSkill, skillPath } = await import('../src/main/mcp/install')

  it('writes the implement skill for Claude Code and Codex once, and skips Gemini', async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    expect(await installSkill('claude', home)).toBe(true)
    expect(await installSkill('claude', home)).toBe(false)
    expect(await installSkill('codex', home)).toBe(true)
    expect(await installSkill('gemini', home)).toBe(false)
    const text = await readFile(skillPath('claude', home)!, 'utf8')
    expect(text).toMatch(/^---\nname: design-handoff\n/)
    expect(text).toContain('get_handoff')
  })
})

describe('installSkill upgrades', async () => {
  const { installSkill, skillPath } = await import('../src/main/mcp/install')

  it('removes the old suikopen-implement skill and never overwrites a user skill with the same name', async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    const old = skillPath('claude', home, 'suikopen-implement')!
    await mkdir(dirname(old), { recursive: true })
    await writeFile(old, '---\nname: suikopen-implement\n---\ncall get_handoff')
    expect(await installSkill('claude', home)).toBe(true)
    await expect(readFile(old, 'utf8')).rejects.toThrow()
    const mine = skillPath('codex', home)!
    await mkdir(dirname(mine), { recursive: true })
    await writeFile(mine, '---\nname: design-handoff\n---\nmy own')
    expect(await installSkill('codex', home)).toBe(false)
    expect(await readFile(mine, 'utf8')).toContain('my own')
  })
})
