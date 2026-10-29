import { describe, expect, it } from 'vitest'
import { labelAt, labelsOf } from '../src/renderer/canvas/labels'
import type { Document } from '../src/shared/schema/document'

const raw: Document = {
  version: 1,
  children: [
    {
      id: 'page',
      type: 'frame',
      name: 'Page',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      children: [{ id: 'card', type: 'frame', name: 'Card', x: 10, y: 10, width: 100, height: 50, children: [] }],
    },
    { id: 'use', type: 'ref', masterId: 'card', x: 500, y: 0, width: 100, height: 50 },
    { id: 'dot', type: 'rectangle', x: 700, y: 0, width: 10, height: 10 },
  ],
}

describe('canvas labels', () => {
  const labels = labelsOf(raw, raw)

  it('labels top-level frames and masters only', () => {
    expect(labels.map((label) => [label.item.node.id, label.component])).toEqual([
      ['page', false],
      ['card', true],
    ])
  })

  it('hits the strip above a frame and hides labels on tiny frames', () => {
    const viewport = { x: 0, y: 100, scale: 1 }
    expect(labelAt(labels, viewport, { x: 200, y: 88 })?.node.id).toBe('page')
    expect(labelAt(labels, viewport, { x: 200, y: 120 })).toBeNull()
    expect(labelAt(labels, { x: 0, y: 100, scale: 0.05 }, { x: 5, y: 88 })).toBeNull()
  })
})
