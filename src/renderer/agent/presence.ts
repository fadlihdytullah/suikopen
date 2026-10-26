export const REVEAL_STEP_MS = 45
export const REVEAL_FADE_MS = 220
export const GLOW_FADE_MS = 400

type State = { working: boolean; focusId: string | null; focusAt: number }

let state: State = { working: false, focusId: null, focusAt: 0 }
let fading: { id: string; at: number } | null = null
const reveals = new Map<string, number>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribePresence(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function presence(): State {
  return state
}

export function setAgentWorking(working: boolean): void {
  fading = !working && state.focusId ? { id: state.focusId, at: performance.now() } : working ? null : fading
  state = { ...state, working, focusId: working ? state.focusId : null }
  notify()
}

export function markAgentTouch(focusId: string, revealIds: string[] = []): void {
  const now = performance.now()
  revealIds.forEach((id, index) => reveals.set(id, now + index * REVEAL_STEP_MS))
  state = { ...state, focusId, focusAt: now }
  notify()
}

export function revealAlpha(id: string, now: number): number {
  const start = reveals.get(id)
  if (start === undefined) {
    return 1
  }
  const progress = (now - start) / REVEAL_FADE_MS
  if (progress >= 1) {
    reveals.delete(id)
    return 1
  }
  return Math.max(0, progress)
}

export function agentGlow(now: number): { id: string; alpha: number } | null {
  if (state.working && state.focusId) {
    return { id: state.focusId, alpha: Math.min(1, (now - state.focusAt) / GLOW_FADE_MS) }
  }
  if (fading) {
    const alpha = 1 - (now - fading.at) / GLOW_FADE_MS
    if (alpha > 0) return { id: fading.id, alpha }
    fading = null
  }
  return null
}

export function isAnimating(): boolean {
  return state.working || reveals.size > 0 || fading !== null
}
