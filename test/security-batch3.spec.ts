import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authorized } from '../src/main/mcp/server'
import { loadToken } from '../src/main/mcp/token'
import { installIntoCodex, installIntoGemini, serverEntry } from '../src/main/mcp/install'
import { createHistory } from '../src/renderer/store/history'

describe('MCP token', () => {
  it('creates a private token once and reuses it', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'token-')), 'mcp-token')
    const first = await loadToken(path)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(await loadToken(path)).toBe(first)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('accepts only the exact bearer token', () => {
    expect(authorized('Bearer abc', 'abc')).toBe(true)
    expect(authorized('Bearer abd', 'abc')).toBe(false)
    expect(authorized(undefined, 'abc')).toBe(false)
    expect(authorized('abc', 'abc')).toBe(false)
  })

  it('writes the token into client configs and reinstalls when it changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'install-'))
    const codex = join(dir, 'config.toml')
    expect((await installIntoCodex(codex, 29980, 'one')).changed).toBe(true)
    expect(await readFile(codex, 'utf8')).toContain('http_headers = { Authorization = "Bearer one" }')
    expect((await installIntoCodex(codex, 29980, 'one')).changed).toBe(false)
    expect((await installIntoCodex(codex, 29980, 'two')).changed).toBe(true)
    expect((await readFile(codex, 'utf8')).match(/mcp_servers\.suikopen/g)).toHaveLength(1)

    const gemini = join(dir, 'settings.json')
    await installIntoGemini(gemini, 29980, 'one')
    expect(JSON.parse(await readFile(gemini, 'utf8')).mcpServers.suikopen.headers).toEqual({ Authorization: 'Bearer one' })
    expect(serverEntry(29980, 'one').headers).toEqual({ Authorization: 'Bearer one' })
  })
})

describe('history', () => {
  it('keeps inverse patches in reverse order across a gesture', () => {
    const history = createHistory()
    history.open('drag')
    history.append([{ op: 'replace', path: ['a'], value: 1 }], [{ op: 'replace', path: ['a'], value: 0 }])
    history.append([{ op: 'replace', path: ['a'], value: 2 }], [{ op: 'replace', path: ['a'], value: 1 }])
    const entry = history.close()
    expect(entry?.inverse.map((patch) => patch.value)).toEqual([1, 0])
  })
})
