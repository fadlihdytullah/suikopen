import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/shared/schema/document'
import { hitTest, itemsWithin } from '../src/renderer/canvas/hit-test'
import { sceneItems, unionBounds } from '../src/renderer/canvas/scene-index'
import { createSelectionStore } from '../src/renderer/store/selection'

const document = parseDocument({
  version: 1,
  children: [
    {
      id: 'f1',
      type: 'frame',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      fill: '#ffffff',
      children: [
        { id: 'r1', type: 'rectangle', x: 24, y: 64, width: 342, height: 120, fill: '#2f6fed' },
        { id: 'e1', type: 'ellipse', x: 48, y: 88, width: 72, height: 72, fill: '#ffd166' },
        { id: 't1', type: 'text', x: 24, y: 208, width: 342, height: 40, fill: '#101114', content: 'Hello' },
      ],
    },
  ],
})
const items = sceneItems(document)

describe('sceneItems', () => {
  it('resolves absolute positions through nesting', () => {
    const avatar = items.find((item) => item.node.id === 'e1')!

    expect({ x: avatar.x, y: avatar.y }).toEqual({ x: 48, y: 88 })
    expect(avatar.parentId).toBe('f1')
  })

  it('is memoised per document', () => {
    expect(sceneItems(document)).toBe(items)
  })
})

describe('hitTest', () => {
  it('picks the topmost node under the point, inside nested frames', () => {
    expect(hitTest(items, { x: 60, y: 100 })?.node.id).toBe('e1')
    expect(hitTest(items, { x: 300, y: 100 })?.node.id).toBe('r1')
    expect(hitTest(items, { x: 300, y: 500 })?.node.id).toBe('f1')
  })

  it('returns null outside every node', () => {
    expect(hitTest(items, { x: -10, y: -10 })).toBeNull()
  })
})

describe('itemsWithin', () => {
  it('selects enclosed nodes without also selecting their children', () => {
    const selected = itemsWithin(items, { x: -10, y: -10, width: 500, height: 900 })

    expect(selected.map((item) => item.node.id)).toEqual(['f1'])
  })

  it('selects siblings when the marquee misses the frame', () => {
    const selected = itemsWithin(items, { x: 20, y: 60, width: 360, height: 150 })

    expect(selected.map((item) => item.node.id).sort()).toEqual(['e1', 'r1'])
  })

  it('ignores partially covered nodes', () => {
    expect(itemsWithin(items, { x: 24, y: 64, width: 10, height: 10 })).toEqual([])
  })
})

describe('unionBounds', () => {
  it('covers every rect', () => {
    const card = items.find((item) => item.node.id === 'r1')!
    const title = items.find((item) => item.node.id === 't1')!

    expect(unionBounds([card, title])).toEqual({ x: 24, y: 64, width: 342, height: 184 })
  })

  it('is null for nothing', () => {
    expect(unionBounds([])).toBeNull()
  })
})

describe('createSelectionStore', () => {
  it('toggles, replaces and clears, notifying only on change', () => {
    const selection = createSelectionStore()
    let notified = 0
    selection.subscribe(() => (notified += 1))

    selection.set(['a', 'b'])
    selection.set(['b', 'a'])
    selection.toggle('a')
    selection.clear()

    expect(notified).toBe(3)
    expect(selection.getState().size).toBe(0)
  })
})
