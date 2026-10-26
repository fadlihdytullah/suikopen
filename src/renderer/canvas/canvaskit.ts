import CanvasKitInit from 'canvaskit-wasm'
import type { CanvasKit } from 'canvaskit-wasm'
import wasmURL from 'canvaskit-wasm/bin/canvaskit.wasm?url'

export type CanvasKitInitializer = (options: { locateFile: (file: string) => string }) => Promise<CanvasKit>

export function createCanvasKitLoader(init: CanvasKitInitializer, wasmUrl: string): () => Promise<CanvasKit> {
  let pending: Promise<CanvasKit> | null = null

  return () => {
    pending ??= init({ locateFile: () => wasmUrl })
    return pending
  }
}

export const loadCanvasKit = createCanvasKitLoader(CanvasKitInit as unknown as CanvasKitInitializer, wasmURL)
