import { describe, expect, it } from 'vitest'
import {
  clampScale,
  fitToBounds,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  toDocument,
  toScreen,
  zoomAt,
  type Viewport,
} from '../src/renderer/canvas/viewport'

const panned: Viewport = { x: 120, y: -40, scale: 2.5 }
const points = [
  { x: 0, y: 0 },
  { x: 24, y: 208 },
  { x: -300.5, y: 77.25 },
]

describe('toDocument and toScreen', () => {
  it('round-trips under a pan plus a zoom', () => {
    for (const point of points) {
      const result = toDocument(panned, toScreen(panned, point))

      expect(result.x).toBeCloseTo(point.x, 10)
      expect(result.y).toBeCloseTo(point.y, 10)
    }
  })

  it('is the identity at the identity viewport', () => {
    expect(toDocument({ x: 0, y: 0, scale: 1 }, { x: 13, y: 17 })).toEqual({ x: 13, y: 17 })
  })
})

describe('zoomAt', () => {
  it('keeps the document point under the cursor fixed', () => {
    const cursor = { x: 640, y: 400 }
    const before = toDocument(panned, cursor)

    const after = toDocument(zoomAt(panned, cursor, 1.8), cursor)

    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
  })

  it('still anchors when the scale clamps', () => {
    const cursor = { x: 200, y: 150 }
    const zoomed = zoomAt(panned, cursor, 1e6)

    expect(zoomed.scale).toBe(MAX_SCALE)
    expect(toDocument(zoomed, cursor).x).toBeCloseTo(toDocument(panned, cursor).x, 8)
  })

  it('clamps at both ends', () => {
    expect(clampScale(1e9)).toBe(MAX_SCALE)
    expect(clampScale(0)).toBe(MIN_SCALE)
  })
})

describe('panBy', () => {
  it('moves the origin and leaves the scale alone', () => {
    const result = panBy(panned, -30, 12)

    expect(result).toEqual({ x: 90, y: -28, scale: 2.5 })
  })
})

describe('fitToBounds', () => {
  it('centres the bounds in the viewport', () => {
    const bounds = { x: 0, y: 0, width: 390, height: 844 }

    const viewport = fitToBounds(bounds, 1280, 800)
    const topLeft = toScreen(viewport, { x: bounds.x, y: bounds.y })
    const bottomRight = toScreen(viewport, { x: bounds.x + bounds.width, y: bounds.y + bounds.height })

    expect(topLeft.x + bottomRight.x).toBeCloseTo(1280, 6)
    expect(topLeft.y + bottomRight.y).toBeCloseTo(800, 6)
    expect(bottomRight.y - topLeft.y).toBeLessThanOrEqual(800 - 96 + 1e-6)
  })

  it('falls back to the identity for empty bounds', () => {
    expect(fitToBounds({ x: 0, y: 0, width: 0, height: 0 }, 800, 600)).toEqual({ x: 0, y: 0, scale: 1 })
  })
})
