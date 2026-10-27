import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

let cached: Promise<string> | null = null

export async function loadToken(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, 'utf8')).trim()
    if (/^[a-f0-9]{64}$/.test(existing)) {
      return existing
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  const token = randomBytes(32).toString('hex')
  await writeFile(path, token, { encoding: 'utf8', mode: 0o600 })
  return token
}

export function mcpToken(): Promise<string> {
  cached ??= loadToken(join(app.getPath('userData'), 'mcp-token'))
  return cached
}
