import { describe, expect, it } from 'vitest'
import type { Document } from '../src/shared/schema/document'
import type { Node } from '../src/shared/schema/node'
import { createDocumentStore } from '../src/renderer/store/document-store'
import { arrangeNodes, duplicateNodes, pasteNodes, unwrapNodes, wrapNodes } from '../src/renderer/store/mutations'

const rect = (id: string, x = 0, y = 0): Node => ({ id, type: 'rectangle', x, y, width: 10, height: 10 })

function doc(): Document {
  return { version: 1, children: [rect('a', 10, 10), rect('b', 50, 30), rect('c', 0, 0)] }
}

const ids = (nodes: Node[]) => nodes.map((node) => node.id)

describe('arrangeNodes', () => {
  it('steps and jumps through z-order', () => {
    const store = createDocumentStore(doc())
    arrangeNodes(store, ['a'], 'forward')
    expect(ids(store.getState().children)).toEqual(['b', 'a', 'c'])
    arrangeNodes(store, ['a'], 'front')
    expect(ids(store.getState().children)).toEqual(['b', 'c', 'a'])
    arrangeNodes(store, ['a', 'c'], 'back')
    expect(ids(store.getState().children)).toEqual(['c', 'a', 'b'])
    arrangeNodes(store, ['b'], 'backward')
    expect(ids(store.getState().children)).toEqual(['c', 'b', 'a'])
  })
})

describe('duplicateNodes', () => {
  it('inserts an offset copy above the original with a fresh id', () => {
    const store = createDocumentStore(doc())
    const [copy] = duplicateNodes(store, ['a'], 10)
    const children = store.getState().children
    expect(children[1]).toMatchObject({ id: copy, x: 20, y: 20 })
    expect(copy).not.toBe('a')
  })
})

describe('wrapNodes / unwrapNodes', () => {
  it('groups keeping absolute positions, then ungroups back', () => {
    const store = createDocumentStore(doc())
    const absolutes = new Map([
      ['a', { x: 10, y: 10 }],
      ['b', { x: 50, y: 30 }],
    ])
    const id = wrapNodes(store, ['a', 'b'], 'group', { x: 10, y: 10, width: 50, height: 30 }, { x: 0, y: 0 }, absolutes)!
    const group = store.getState().children[0] as Node & { children: Node[] }
    expect(ids(store.getState().children)).toEqual([id, 'c'])
    expect(group).toMatchObject({ type: 'group', x: 10, y: 10, width: 50, height: 30 })
    expect(group.children.map((child) => [child.id, child.x, child.y])).toEqual([
      ['a', 0, 0],
      ['b', 40, 20],
    ])

    unwrapNodes(store, [id], new Map([[id, { x: 0, y: 0 }]]), absolutes)
    expect(store.getState().children.map((child) => [child.id, child.x, child.y])).toEqual([
      ['a', 10, 10],
      ['b', 50, 30],
      ['c', 0, 0],
    ])
    store.undo()
    expect(ids(store.getState().children)).toEqual([id, 'c'])
  })
})

describe('pasteNodes', () => {
  it('pastes relative to the target origin with fresh ids', () => {
    const store = createDocumentStore(doc())
    const [id] = pasteNodes(store, [{ node: rect('a'), absolute: { x: 100, y: 100 } }], null, { x: 0, y: 0 }, 10)
    expect(store.getState().children.at(-1)).toMatchObject({ id, x: 110, y: 110 })
  })
})
