import type { CanvasKit, Surface } from 'canvaskit-wasm'

export type SizedCanvas = {
  width: number
  height: number
  style: { width: string; height: string }
}

export type SurfaceHandle = {
  surface: Surface
  dpr: number
  cssWidth: number
  cssHeight: number
  dispose: () => void
}

export function applyCanvasSize(canvas: SizedCanvas, cssWidth: number, cssHeight: number, dpr: number): void {
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
}

export function wrapSurface(surface: Surface, cssWidth: number, cssHeight: number, dpr: number): SurfaceHandle {
  let disposed = false

  return {
    surface,
    dpr,
    cssWidth,
    cssHeight,
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      surface.delete()
    },
  }
}

export function createSurface(
  canvasKit: CanvasKit,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number
): SurfaceHandle | null {
  applyCanvasSize(canvas, cssWidth, cssHeight, dpr)

  const surface = canvasKit.MakeWebGLCanvasSurface(canvas) ?? canvasKit.MakeSWCanvasSurface(canvas)
  if (!surface) {
    return null
  }

  return wrapSurface(surface, cssWidth, cssHeight, dpr)
}
