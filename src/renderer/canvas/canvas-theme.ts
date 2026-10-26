import { useSyncExternalStore } from 'react'

export type CanvasAppearance = 'dark' | 'light' | 'system'
type Color = [number, number, number, number]

const KEY = 'suikopen.canvas.appearance'
const BACKGROUNDS: Record<'dark' | 'light', Color> = { dark: [0.118, 0.122, 0.133, 1], light: [0.961, 0.961, 0.965, 1] }
const media = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

let appearance: CanvasAppearance =
  (['dark', 'light', 'system'] as const).find((value) => typeof localStorage !== 'undefined' && value === localStorage.getItem(KEY)) ?? 'dark'

const notify = () => listeners.forEach((listener) => listener())
media?.addEventListener('change', () => appearance === 'system' && notify())

export function canvasIsDark(): boolean {
  return appearance === 'system' ? (media?.matches ?? true) : appearance === 'dark'
}

export function canvasStripe(): Color {
  return canvasIsDark() ? [1, 1, 1, 0.028] : [0, 0, 0, 0.04]
}

export function canvasBackground(): Color {
  return BACKGROUNDS[canvasIsDark() ? 'dark' : 'light']
}

export function setCanvasAppearance(next: CanvasAppearance): void {
  appearance = next
  localStorage.setItem(KEY, next)
  notify()
}

export function onCanvasAppearanceChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCanvasAppearance(): CanvasAppearance {
  return useSyncExternalStore(onCanvasAppearanceChange, () => appearance)
}
