import { useSyncExternalStore } from 'react'

export type LeftTab = 'layers' | 'agent' | 'memory'
type State = { leftTab: LeftTab; hidden: boolean }

let state: State = { leftTab: 'layers', hidden: false }
const listeners = new Set<() => void>()

function set(next: Partial<State>): void {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export const showLeftTab = (leftTab: LeftTab) => set({ leftTab, hidden: false })
export const togglePanels = () => set({ hidden: !state.hidden })

export const PANEL_GAP = 8

const insets = { left: 0, right: 0 }

export function setPanelInset(side: 'left' | 'right', width: number): void {
  insets[side] = width ? width + PANEL_GAP : 0
  document.documentElement.style.setProperty(`--${side}-inset`, `${insets[side]}px`)
}

export function panelInsets(): { left: number; right: number } {
  return { ...insets }
}

export function usePanels(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}
