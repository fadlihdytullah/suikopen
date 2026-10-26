import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseDocument, type Document } from '../src/shared/schema/document'
import { createDocumentStore } from '../src/renderer/store/document-store'
import { createMutationQueue } from '../src/renderer/store/mutation-queue'
import { createSelectionStore } from '../src/renderer/store/selection'
import { createAgentHandlers } from '../src/renderer/mcp/handlers'
import { installIntoClaudeCode, serverEntry, SERVER_KEY } from '../src/main/mcp/install'

function fixture(): Document {
  return parseDocument({
    version: 1,
    children: [
      {
        id: 'f1',
        type: 'frame',
        name: 'Screen',
        x: 0,
        y: 0,
        width: 200,
        height: 400,
        children: [
          { id: 'r1', type: 'rectangle', name: 'Card', x: 10, y: 10, width: 100, height: 40, fill: '#2f6fed' },
          { id: 't1', type: 'text', name: 'Title', x: 10, y: 60, width: 100, height: 20, content: 'Hi' },
        ],
      },
    ],
  })
}

function harness() {
  const store = createDocumentStore(fixture())
  const selection = createSelectionStore()
  const queue = createMutationQueue(store)
  const handle = createAgentHandlers({ store, selection, queue, documentPath: () => '/tmp/doc.spen' })

  const call = (method: string, params: Record<string, unknown> = {}) =>
    handle({ id: method, method, params })

  return { store, selection, queue, call }
}

describe('agent read tools', () => {
  it('reports the document', async () => {
    const { call } = harness()

    expect(await call('get_document_info')).toEqual({
      path: '/tmp/doc.spen',
      version: 1,
      nodeCount: 3,
      rootIds: ['f1'],
    })
  })

  it('returns the tree with child ids and absolute rects', async () => {
    const { call } = harness()
    const tree = (await call('get_tree')) as { id: string; rect: { x: number; y: number }; childIds?: string[] }[]

    expect(tree.map((entry) => entry.id)).toEqual(['f1', 'r1', 't1'])
    expect(tree[0]?.childIds).toEqual(['r1', 't1'])
    expect(tree[1]?.rect).toMatchObject({ x: 10, y: 10 })
  })

  it('finds nodes by name and by type', async () => {
    const { call } = harness()

    expect(((await call('find_nodes', { name: 'card' })) as { id: string }[]).map((n) => n.id)).toEqual(['r1'])
    expect(((await call('find_nodes', { type: 'text' })) as { id: string }[]).map((n) => n.id)).toEqual(['t1'])
  })

  it('refuses an unknown id with a readable message', async () => {
    const { call } = harness()

    await expect(call('get_node', { id: 'nope' })).rejects.toThrow(/No node with id "nope"/)
  })

  it('refuses an unknown method', async () => {
    const { call } = harness()

    await expect(call('do_magic')).rejects.toThrow(/Unknown method/)
  })
})

describe('agent write tools', () => {
  it('creates, updates and deletes nodes, each undoable by the user', async () => {
    const { call, store } = harness()

    await call('create_node', {
      parentId: 'f1',
      node: { id: 'new1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 },
    })
    expect(store.getState().children[0]).toMatchObject({ type: 'frame' })
    expect((await call('get_document_info')) as { nodeCount: number }).toMatchObject({ nodeCount: 4 })

    await call('update_node', { id: 'new1', props: { width: 50 } })
    await call('delete_nodes', { ids: ['r1'] })
    expect((await call('get_document_info')) as { nodeCount: number }).toMatchObject({ nodeCount: 3 })

    store.undo()
    store.undo()
    store.undo()
    expect((await call('get_document_info')) as { nodeCount: number }).toMatchObject({ nodeCount: 3 })
    expect(store.canUndo()).toBe(false)
  })

  it('replaces text content and refuses a non-text node', async () => {
    const { call } = harness()

    await call('set_text', { id: 't1', content: 'Changed' })
    const node = (await call('get_node', { id: 't1' })) as { node: { content: string } }
    expect(node.node.content).toBe('Changed')

    await expect(call('set_text', { id: 'r1', content: 'x' })).rejects.toThrow(/is a rectangle, not text/)
  })

  it('refuses a create into a parent that cannot hold children', async () => {
    const { call } = harness()

    await expect(
      call('create_node', { parentId: 'r1', node: { id: 'x', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 } })
    ).rejects.toThrow(/Could not insert/)
  })
})

describe('mutation queue', () => {
  it('defers a write while a direct gesture is open, then applies it', async () => {
    const { call, store } = harness()

    store.beginGesture('Move')
    const pending = call('move_node', { id: 'r1', x: 99 })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((store.getState().children[0] as { children: { x: number }[] }).children[0]?.x).toBe(10)

    store.endGesture()
    await pending

    expect((store.getState().children[0] as { children: { x: number }[] }).children[0]?.x).toBe(99)
  })

  it('runs queued writes in order', async () => {
    const { call, store } = harness()

    await Promise.all([
      call('move_node', { id: 'r1', x: 1 }),
      call('move_node', { id: 'r1', x: 2 }),
      call('move_node', { id: 'r1', x: 3 }),
    ])

    expect((store.getState().children[0] as { children: { x: number }[] }).children[0]?.x).toBe(3)
  })

  it('gives up on a gesture that never ends', async () => {
    vi.useFakeTimers()
    const { call, store } = harness()
    store.beginGesture('Stuck')

    const pending = call('move_node', { id: 'r1', x: 5 })
    const assertion = expect(pending).rejects.toThrow(/busy with a direct edit/)
    await vi.advanceTimersByTimeAsync(11_000)
    await assertion

    vi.useRealTimers()
  })
})

describe('installIntoClaudeCode', () => {
  it('adds the server entry and is idempotent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'suikopen-mcp-'))
    const path = join(directory, '.claude.json')
    await writeFile(path, JSON.stringify({ mcpServers: { other: { type: 'http', url: 'http://x' } } }), 'utf8')

    const first = await installIntoClaudeCode(path, 29980)
    const second = await installIntoClaudeCode(path, 29980)

    const config = JSON.parse(await readFile(path, 'utf8')) as { mcpServers: Record<string, unknown> }

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(config.mcpServers[SERVER_KEY]).toEqual(serverEntry(29980))
    expect(config.mcpServers['other']).toEqual({ type: 'http', url: 'http://x' })
    expect(JSON.parse(await readFile(`${path}.suikopen-backup`, 'utf8'))).toMatchObject({ mcpServers: {} })
  })

  it('creates the file when there is none', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'suikopen-mcp-'))
    const path = join(directory, '.claude.json')

    const result = await installIntoClaudeCode(path, 1234)

    expect(result.changed).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8')).mcpServers[SERVER_KEY].url).toContain('1234')
  })
})
