import type { Rect } from '../canvas/scene-index'
import type { Point } from '../canvas/viewport'

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandleId = (typeof HANDLES)[number]

export const MIN_SIZE = 1

export function handlePoint(bounds: Rect, handle: HandleId): Point {
  const left = bounds.x
  const right = bounds.x + bounds.width
  const top = bounds.y
  const bottom = bounds.y + bounds.height
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2

  switch (handle) {
    case 'nw':
      return { x: left, y: top }
    case 'n':
      return { x: centerX, y: top }
    case 'ne':
      return { x: right, y: top }
    case 'e':
      return { x: right, y: centerY }
    case 'se':
      return { x: right, y: bottom }
    case 's':
      return { x: centerX, y: bottom }
    case 'sw':
      return { x: left, y: bottom }
    case 'w':
      return { x: left, y: centerY }
  }
}

export function handleAt(bounds: Rect, point: Point, scale: number, screenRadius = 7): HandleId | null {
  const radius = screenRadius / scale

  for (const handle of HANDLES) {
    const center = handlePoint(bounds, handle)
    if (Math.abs(point.x - center.x) <= radius && Math.abs(point.y - center.y) <= radius) {
      return handle
    }
  }

  return null
}

export function resizeBounds(
  bounds: Rect,
  handle: HandleId,
  dx: number,
  dy: number,
  proportional = false
): Rect {
  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw'
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se'
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne'
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se'

  let left = bounds.x
  let right = bounds.x + bounds.width
  let top = bounds.y
  let bottom = bounds.y + bounds.height

  if (movesLeft) {
    left = Math.min(left + dx, right - MIN_SIZE)
  }
  if (movesRight) {
    right = Math.max(right + dx, left + MIN_SIZE)
  }
  if (movesTop) {
    top = Math.min(top + dy, bottom - MIN_SIZE)
  }
  if (movesBottom) {
    bottom = Math.max(bottom + dy, top + MIN_SIZE)
  }

  let width = right - left
  let height = bottom - top

  if (proportional && bounds.width > 0 && bounds.height > 0 && movesLeft !== movesRight && movesTop !== movesBottom) {
    const ratio = bounds.height / bounds.width
    const scaled = Math.max(width, height / ratio)
    width = scaled
    height = scaled * ratio

    if (movesLeft) {
      left = right - width
    } else {
      right = left + width
    }
    if (movesTop) {
      top = bottom - height
    } else {
      bottom = top + height
    }
  }

  return { x: left, y: top, width, height }
}

export function scaleRectInto(item: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width === 0 ? 1 : to.width / from.width
  const sy = from.height === 0 ? 1 : to.height / from.height

  return {
    x: to.x + (item.x - from.x) * sx,
    y: to.y + (item.y - from.y) * sy,
    width: Math.max(MIN_SIZE, item.width * sx),
    height: Math.max(MIN_SIZE, item.height * sy),
  }
}
