import { describe, expect, it } from 'vitest'
import type { Document } from '../src/shared/schema/document'
import type { Node } from '../src/shared/schema/node'
import { createDocumentStore } from '../src/renderer/store/document-store'
import { moveNodes } from '../src/renderer/store/mutations'

const rect = (id: string): Node => ({ id, type: 'rectangle', x: 0, y: 0, width: 1, height: 1 })

function doc(): Document {
  return {
    version: 1,
    children: [rect('a'), { id: 'f', type: 'frame', x: 0, y: 0, width: 10, height: 10, children: [rect('c')] }, rect('b')],
  }
}

const ids = (nodes: Node[]) => nodes.map((node) => node.id)

describe('moveNodes', () => {
  it('reorders siblings: above means later in z-order', () => {
    const store = createDocumentStore(doc())
    moveNodes(store, ['a'], { refId: 'b', position: 'above' })
    expect(ids(store.getState().children)).toEqual(['f', 'b', 'a'])
    moveNodes(store, ['a'], { refId: 'f', position: 'below' })
    expect(ids(store.getState().children)).toEqual(['a', 'f', 'b'])
  })

  it('moves into a frame and out again, undoably', () => {
    const store = createDocumentStore(doc())
    moveNodes(store, ['b'], { refId: 'f', position: 'inside' })
    const frame = store.getState().children[1]
    expect(frame?.type === 'frame' && ids(frame.children)).toEqual(['c', 'b'])
    store.undo()
    expect(ids(store.getState().children)).toEqual(['a', 'f', 'b'])
  })

  it('refuses to move a frame into its own child', () => {
    const store = createDocumentStore(doc())
    moveNodes(store, ['f'], { refId: 'c', position: 'above' })
    expect(ids(store.getState().children)).toEqual(['a', 'f', 'b'])
  })
})
