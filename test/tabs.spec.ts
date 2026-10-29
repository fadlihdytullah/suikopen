import { describe, expect, it } from 'vitest'
import { createTabRegistry } from '../src/main/tabs'
import { imageKey } from '../src/renderer/canvas/image-cache'
import { createTabsStore, isDirty, isPristine, tabName } from '../src/renderer/tabs/tabs-store'
import { updateNodes } from '../src/renderer/store/mutations'
import type { Document } from '../src/shared/schema/document'

const doc = (x: number): Document => ({ version: 1, children: [{ id: 'r', type: 'rectangle', x, y: 0, width: 10, height: 10 }] })

function store() {
  let theme = {}
  return createTabsStore({ get: () => theme, set: (next) => (theme = next) })
}

describe('tabs store', () => {
  it('keeps each tab document and undo separate', () => {
    const tabs = store()
    const a = tabs.open({ id: 'a', document: doc(0), path: '/a.spen', assetBase: '/a.spen' })
    updateNodes(a.store, 'Move', new Map([['r', { x: 5 }]]))
    const b = tabs.open({ id: 'b', document: doc(100), path: '/b.spen', assetBase: '/b.spen' })

    expect(tabs.getState().activeId).toBe('b')
    expect(isDirty(a)).toBe(true)
    expect(isDirty(b)).toBe(false)

    a.store.undo()
    expect(a.store.getState().children[0]!.x).toBe(0)
    expect(b.store.getState().children[0]!.x).toBe(100)
  })

  it('activates the neighbour on close and cycles in order', () => {
    const tabs = store()
    tabs.open({ id: 'a', document: doc(0), path: null, assetBase: null })
    tabs.open({ id: 'b', document: doc(0), path: null, assetBase: null })
    tabs.open({ id: 'c', document: doc(0), path: null, assetBase: null })

    tabs.cycle(1)
    expect(tabs.getState().activeId).toBe('a')
    tabs.cycle(-1)
    expect(tabs.getState().activeId).toBe('c')

    tabs.activate('b')
    tabs.close('b')
    expect(tabs.getState().tabs.map((tab) => tab.id)).toEqual(['a', 'c'])
    expect(tabs.getState().activeId).toBe('c')
  })

  it('replaces a pristine tab in place and keeps theme per tab', () => {
    let theme: Record<string, string> = {}
    const tabs = createTabsStore({ get: () => theme, set: (next) => (theme = next as Record<string, string>) })
    const first = tabs.open({ id: 'a', document: doc(0), path: null, assetBase: null })
    expect(isPristine(first)).toBe(true)

    const next = tabs.replace('a', { id: 'b', document: doc(0), path: '/b.spen', assetBase: '/b.spen' })
    expect(tabs.getState().tabs).toEqual([next])
    expect(tabName(next)).toBe('b')

    theme = { mode: 'dark' }
    tabs.open({ id: 'c', document: doc(0), path: null, assetBase: null })
    expect(theme).toEqual({})
    tabs.activate('b')
    expect(theme).toEqual({ mode: 'dark' })
  })

  it('treats a recovered document as unsaved', () => {
    const tab = store().open({ id: 'a', document: doc(0), path: '/a.spen', assetBase: null, recovered: true })
    expect(isDirty(tab)).toBe(true)
  })
})

describe('tab registry', () => {
  it('returns the open tab for a path, follows Save As and frees on close', () => {
    let next = 0
    const registry = createTabRegistry(() => `t${(next += 1)}`)

    expect(registry.open('/a.spen')).toEqual({ id: 't1', existing: false })
    expect(registry.open('/a.spen')).toEqual({ id: 't1', existing: true })
    expect(registry.open(null)).toEqual({ id: 't2', existing: false })

    registry.rename('t2', '/b.spen')
    expect(registry.idForPath('/b.spen')).toBe('t2')

    registry.close('t1')
    expect(registry.open('/a.spen').existing).toBe(false)
  })
})

describe('image cache key', () => {
  it('separates relative urls by document and shares remote ones', () => {
    expect(imageKey('/x/a.spen', 'logo.png')).not.toBe(imageKey('/y/b.spen', 'logo.png'))
    expect(imageKey('/x/a.spen', 'https://cdn/logo.png')).toBe(imageKey('/y/b.spen', 'https://cdn/logo.png'))
  })
})
