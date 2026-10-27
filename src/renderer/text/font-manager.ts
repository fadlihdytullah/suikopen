import type { CanvasKit, FontMgr } from 'canvaskit-wasm'

export const DEFAULT_FAMILY = 'Arial'

const data = new Map<string, ArrayBuffer>()
const requested = new Set<string>()
let manager: FontMgr | null = null
let generation = 0
let onLoaded: () => void = () => {}

function key(family: string, weight: number, italic: boolean): string {
  return `${family}|${weight}|${italic}`
}

export function onFontLoaded(callback: () => void): void {
  onLoaded = callback
}

export function fontGeneration(): number {
  return generation
}

export function fontManager(): FontMgr | null {
  return manager
}

function rebuild(canvasKit: CanvasKit): void {
  manager?.delete()
  manager = canvasKit.FontMgr.FromData(...data.values())
  generation += 1
}

export async function ensureFont(
  canvasKit: CanvasKit,
  family: string,
  weight = 400,
  italic = false
): Promise<void> {
  const id = key(family, weight, italic)
  if (requested.has(id)) {
    return
  }
  requested.add(id)

  const bytes = await window.suikopen.readFont({ family, weight, italic })
  if (!bytes) {
    return
  }

  data.set(id, bytes)
  rebuild(canvasKit)
  onLoaded()
}

export function requestFont(canvasKit: CanvasKit, family: string, weight = 400, italic = false): void {
  if (!requested.has(key(family, weight, italic))) {
    void ensureFont(canvasKit, family, weight, italic)
  }
}
