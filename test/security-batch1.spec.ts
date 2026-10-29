import { createPresence } from '../src/renderer/agent/presence'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allowedImageUrl } from '../src/shared/image-hosts'
import { installIntoClaudeCode, installIntoGemini } from '../src/main/mcp/install'
import { parseDocument } from '../src/shared/schema/document'
import { createDocumentStore } from '../src/renderer/store/document-store'
import { createMutationQueue } from '../src/renderer/store/mutation-queue'
import { createSelectionStore } from '../src/renderer/store/selection'
import { createAgentHandlers } from '../src/renderer/mcp/handlers'

describe('image hosts', () => {
  it('allows only https from known hosts', () => {
    expect(allowedImageUrl('https://api.iconify.design/lucide/bell.svg?color=%23111111')).toBe(true)
    expect(allowedImageUrl('http://api.iconify.design/lucide/bell.svg')).toBe(false)
    expect(allowedImageUrl('https://evil.example/collect?d=secret')).toBe(false)
    expect(allowedImageUrl('https://api.iconify.design.evil.example/x.svg')).toBe(false)
  })

  it('refuses agent edits that point an image at another host', async () => {
    const store = createDocumentStore(parseDocument({ version: 1, children: [{ id: 'f', type: 'frame', x: 0, y: 0, width: 100, height: 100, children: [] }] }))
    const handle = createAgentHandlers({ store, selection: createSelectionStore(), queue: createMutationQueue(store), presence: createPresence(), documentPath: () => null })
    const node = { id: 'img', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, fill: { type: 'image', url: 'https://evil.example/?d=x' } }

    await expect(handle({ id: '1', method: 'create_node', params: { parentId: 'f', node } })).rejects.toThrow(/was refused/)
    await expect(handle({ id: '2', method: 'update_node', params: { id: 'f', props: { fill: { type: 'image', url: 'https://evil.example/a.png' } } } })).rejects.toThrow(/was refused/)
    await expect(handle({ id: '3', method: 'create_node', params: { parentId: 'f', node: { ...node, fill: { type: 'image', url: './local.png' } } } })).resolves.toBeTruthy()
  })
})

describe('MCP installer safety', () => {
  it('leaves an unreadable config untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'install-'))
    for (const install of [installIntoClaudeCode, installIntoGemini]) {
      const path = join(dir, `${install.name}.json`)
      await writeFile(path, '{"projects": {"half', 'utf8')
      await expect(install(path)).rejects.toThrow(/left untouched/)
      expect(await readFile(path, 'utf8')).toBe('{"projects": {"half')
    }
  })
})
