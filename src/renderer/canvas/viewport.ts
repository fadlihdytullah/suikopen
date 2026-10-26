export type Point = { x: number; y: number }
export type Viewport = { x: number; y: number; scale: number }

export const MIN_SCALE = 0.02
export const MAX_SCALE = 64
export const IDENTITY_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function toDocument(viewport: Viewport, screen: Point): Point {
  return {
    x: (screen.x - viewport.x) / viewport.scale,
    y: (screen.y - viewport.y) / viewport.scale,
  }
}

export function toScreen(viewport: Viewport, document: Point): Point {
  return {
    x: document.x * viewport.scale + viewport.x,
    y: document.y * viewport.scale + viewport.y,
  }
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy }
}

export function zoomAt(viewport: Viewport, screen: Point, factor: number): Viewport {
  const scale = clampScale(viewport.scale * factor)
  const anchor = toDocument(viewport, screen)

  return {
    scale,
    x: screen.x - anchor.x * scale,
    y: screen.y - anchor.y * scale,
  }
}

export function fitToBounds(
  bounds: { x: number; y: number; width: number; height: number },
  cssWidth: number,
  cssHeight: number,
  padding = 48
): Viewport {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return IDENTITY_VIEWPORT
  }

  const scale = clampScale(
    Math.min((cssWidth - padding * 2) / bounds.width, (cssHeight - padding * 2) / bounds.height)
  )

  return {
    scale,
    x: (cssWidth - bounds.width * scale) / 2 - bounds.x * scale,
    y: (cssHeight - bounds.height * scale) / 2 - bounds.y * scale,
  }
}
