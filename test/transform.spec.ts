import { describe, expect, it } from 'vitest'
import { handleAt, handlePoint, resizeBounds, scaleRectInto } from '../src/renderer/tools/transform'
import { snapRect } from '../src/renderer/tools/snapping'

const bounds = { x: 100, y: 100, width: 200, height: 100 }

describe('handleAt', () => {
  it('finds a handle within the screen-space radius at any zoom', () => {
    expect(handleAt(bounds, { x: 100, y: 100 }, 1)).toBe('nw')
    expect(handleAt(bounds, { x: 300, y: 200 }, 1)).toBe('se')
    expect(handleAt(bounds, { x: 301, y: 201 }, 4)).toBe('se')
    expect(handleAt(bounds, { x: 303, y: 203 }, 4)).toBeNull()
  })

  it('places handles on the bounding box', () => {
    expect(handlePoint(bounds, 'n')).toEqual({ x: 200, y: 100 })
    expect(handlePoint(bounds, 'w')).toEqual({ x: 100, y: 150 })
  })
})

describe('resizeBounds', () => {
  it('moves only the edges the handle owns', () => {
    expect(resizeBounds(bounds, 'e', 50, 999)).toEqual({ x: 100, y: 100, width: 250, height: 100 })
    expect(resizeBounds(bounds, 'nw', 20, 20)).toEqual({ x: 120, y: 120, width: 180, height: 80 })
  })

  it('never inverts the rect', () => {
    const result = resizeBounds(bounds, 'e', -500, 0)

    expect(result.width).toBe(1)
    expect(result.x).toBe(100)
  })

  it('keeps the aspect ratio when proportional', () => {
    const result = resizeBounds(bounds, 'se', 100, 0, true)

    expect(result.width / result.height).toBeCloseTo(bounds.width / bounds.height, 10)
  })
})

describe('scaleRectInto', () => {
  it('maps a child rect through a bounds change', () => {
    const from = { x: 0, y: 0, width: 100, height: 100 }
    const to = { x: 10, y: 10, width: 200, height: 50 }

    expect(scaleRectInto({ x: 50, y: 50, width: 50, height: 50 }, from, to)).toEqual({
      x: 110,
      y: 35,
      width: 100,
      height: 25,
    })
  })
})

describe('snapRect', () => {
  it('snaps an edge to a nearby candidate and reports a guide', () => {
    const moving = { x: 103, y: 50, width: 50, height: 50 }
    const result = snapRect(moving, [{ x: 100, y: 0, width: 200, height: 20 }], 6)

    expect(result.dx).toBe(-3)
    expect(result.dy).toBe(0)
    expect(result.guides.map((guide) => guide.axis)).toEqual(['x'])
  })

  it('snaps centres as well as edges', () => {
    const moving = { x: 0, y: 0, width: 10, height: 10 }
    const result = snapRect(moving, [{ x: 0, y: 0, width: 12, height: 10 }], 6)

    expect(result.dx).toBe(0)
  })

  it('does nothing outside the threshold', () => {
    const result = snapRect({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 100, y: 100, width: 10, height: 10 }], 6)

    expect(result).toEqual({ dx: 0, dy: 0, guides: [] })
  })
})
