import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTabId } from '../src/main/mcp/server'
import { createHistoryVault, createRecovery } from '../src/main/recovery'
import { createLru } from '../src/renderer/canvas/image-cache'
import { updateNodes } from '../src/renderer/store/mutations'
import { createTabRouter } from '../src/renderer/tabs/router'
import { sleepIdleTabs, wakeTab, type HistoryVault } from '../src/renderer/tabs/sleep'
import { createTabsStore, middleEllipsis, tabLabels } from '../src/renderer/tabs/tabs-store'
import type { Document } from '../src/shared/schema/document'

const doc = (id = 'r'): Document => ({ version: 1, children: [{ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] })

function store() {
  let theme = {}
  return createTabsStore({ get: () => theme, set: (next) => (theme = next) })
}

describe('tab bar model', () => {
  it('keeps pinned tabs first and bounds reordering', () => {
    const tabs = store()
    for (const id of ['a', 'b', 'c']) tabs.open({ id, document: doc(), path: null, assetBase: null })
    tabs.togglePin('c')
    expect(tabs.getState().tabs.map((tab) => tab.id)).toEqual(['c', 'a', 'b'])
    tabs.move('b', 0)
    expect(tabs.getState().tabs.map((tab) => tab.id)).toEqual(['c', 'b', 'a'])
  })

  it('labels duplicate names with their folder and shortens in the middle', () => {
    const tabs = store()
    tabs.open({ id: 'a', document: doc(), path: '/x/one/home.spen', assetBase: null })
    tabs.open({ id: 'b', document: doc(), path: '/x/two/home.spen', assetBase: null })
    const labels = tabLabels(tabs.getState().tabs)
    expect(labels.get('a')).toBe('home — one')
    expect(labels.get('b')).toBe('home — two')
    expect(middleEllipsis('landing-page-version-two-final', 12)).toBe('landin…final')
  })
})

describe('MCP tab routing', () => {
  it('prefers an explicit tab over the session tab', () => {
    expect(resolveTabId('t2', 't1')).toBe('t2')
    expect(resolveTabId(undefined, 't1')).toBe('t1')
    expect(resolveTabId('', undefined)).toBeUndefined()
  })

  it('edits an inactive tab, lists tabs and refuses closed ones', async () => {
    const tabs = store()
    tabs.open({ id: 'a', document: doc('ra'), path: '/a.spen', assetBase: null })
    tabs.open({ id: 'b', document: doc('rb'), path: '/b.spen', assetBase: null })
    const route = createTabRouter(tabs)

    const reply = await route({ id: '1', method: 'update_node', params: { id: 'ra', props: { x: 40 } }, tabId: 'a' })
    expect(reply.tab).toEqual({ id: 'a', name: 'a' })
    expect(tabs.get('a')!.store.getState().children[0]!.x).toBe(40)
    expect(tabs.get('b')!.store.getState().children[0]!.x).toBe(0)

    const listed = (await route({ id: '2', method: 'list_tabs', params: {} })).value as { id: string; active: boolean; dirty: boolean }[]
    expect(listed.map((tab) => [tab.id, tab.active, tab.dirty])).toEqual([
      ['a', false, true],
      ['b', true, false],
    ])

    tabs.close('a')
    await expect(route({ id: '3', method: 'get_tree', params: {}, tabId: 'a' })).rejects.toThrow(/Tab "a" is closed/)
  })
})

describe('per-tab recovery', () => {
  it('writes, reads and clears checkpoints per tab', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'suikopen-recovery-'))
    const recovery = createRecovery(dir)
    await recovery.write('t1', { document: doc(), path: '/a.spen', assetBase: '/a.spen', dirty: true })
    await recovery.write('t2', { document: doc(), path: null, assetBase: null, dirty: false })
    await recovery.write('../evil', { document: doc(), path: null, assetBase: null, dirty: true })
    await recovery.writeSession({ order: ['t1', 't2'], activeId: 't2', paths: { t1: '/a.spen', t2: null } })

    const read = await createRecovery(dir).read()
    expect(read.session).toEqual({ order: ['t1', 't2'], activeId: 't2', paths: { t1: '/a.spen', t2: null } })
    expect([...read.checkpoints.keys()].sort()).toEqual(['t1', 't2'])

    await recovery.remove('t1')
    await recovery.clearCheckpoints()
    expect(await readdir(dir)).toEqual(['session.json'])
  })
})

describe('memory', () => {
  it('evicts least recently used images past the budget', () => {
    const disposed: string[] = []
    const lru = createLru<{ name: string; bytes: number }>(100, (entry) => disposed.push(entry.name))
    lru.set('a', { name: 'a', bytes: 0 })
    lru.grow('a', 60)
    lru.set('b', { name: 'b', bytes: 0 })
    lru.grow('b', 30)
    lru.get('a')
    lru.set('c', { name: 'c', bytes: 0 })
    lru.grow('c', 30)
    expect(disposed).toEqual(['b'])
    expect(lru.total()).toBe(90)
  })

  it('sleeps idle tabs and restores full undo on wake', async () => {
    const files = new Map<string, string>()
    const vault: HistoryVault = {
      spill: async (id, json) => void files.set(id, json),
      take: async (id) => {
        const json = files.get(id) ?? null
        files.delete(id)
        return json
      },
    }
    const tabs = store()
    const a = tabs.open({ id: 'a', document: doc(), path: null, assetBase: null })
    updateNodes(a.store, 'Move', new Map([['r', { x: 5 }]]))
    tabs.open({ id: 'b', document: doc(), path: null, assetBase: null })

    expect(await sleepIdleTabs(tabs, vault, a.inactiveSince + 1000, 5000)).toEqual([])
    expect(await sleepIdleTabs(tabs, vault, a.inactiveSince + 6000, 5000)).toEqual(['a'])
    expect(a.asleep).toBe(true)
    expect(a.store.canUndo()).toBe(false)

    await wakeTab(a, vault)
    expect(a.asleep).toBe(false)
    a.store.undo()
    expect(a.store.getState().children[0]!.x).toBe(0)
  })

  it('shares a history vault on disk and rejects bad ids', async () => {
    const vault = createHistoryVault(await mkdtemp(join(tmpdir(), 'suikopen-history-')))
    await vault.spill('t1', '{"past":[],"future":[]}')
    await vault.spill('../x', 'nope')
    expect(await vault.take('t1')).toBe('{"past":[],"future":[]}')
    expect(await vault.take('t1')).toBeNull()
    expect(await vault.take('../x')).toBeNull()
  })
})
