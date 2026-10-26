import { IDENTITY_VIEWPORT, type Viewport } from './viewport'

let current: Viewport = IDENTITY_VIEWPORT
let canvasOrigin = { x: 0, y: 0 }

const viewportListeners = new Set<() => void>()

export function publishViewport(viewport: Viewport, origin: { x: number; y: number }): void {
  current = viewport
  canvasOrigin = origin
  viewportListeners.forEach((listener) => listener())
}

export function onViewportChange(listener: () => void): () => void {
  viewportListeners.add(listener)
  return () => viewportListeners.delete(listener)
}

export type ZoomRequest = 'in' | 'out' | 'actual' | 'fit' | 'selection'

const zoomListeners = new Set<(request: ZoomRequest) => void>()

export function onZoomRequest(listener: (request: ZoomRequest) => void): () => void {
  zoomListeners.add(listener)
  return () => zoomListeners.delete(listener)
}

export function requestZoom(request: ZoomRequest): void {
  zoomListeners.forEach((listener) => listener(request))
}

export function currentViewport(): { viewport: Viewport; origin: { x: number; y: number } } {
  return { viewport: current, origin: canvasOrigin }
}

const fitListeners = new Set<() => void>()

export function onFitRequest(listener: () => void): () => void {
  fitListeners.add(listener)
  return () => fitListeners.delete(listener)
}

export function requestFit(): void {
  for (const listener of fitListeners) {
    listener()
  }
}
