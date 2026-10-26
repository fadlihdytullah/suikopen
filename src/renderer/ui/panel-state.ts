import { useSyncExternalStore } from 'react'

export type LeftTab = 'layers' | 'agent'
type State = { leftTab: LeftTab; hidden: boolean }

let state: State = { leftTab: 'layers', hidden: false }
const listeners = new Set<() => void>()

function set(next: Partial<State>): void {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export const showLeftTab = (leftTab: LeftTab) => set({ leftTab, hidden: false })
export const togglePanels = () => set({ hidden: !state.hidden })

export function usePanels(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}
