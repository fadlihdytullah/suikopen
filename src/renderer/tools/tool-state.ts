import { useSyncExternalStore } from 'react'

export type Tool = 'move' | 'frame' | 'rectangle' | 'ellipse' | 'text' | 'hand'

export const TOOL_KEYS: Record<string, Tool> = { v: 'move', f: 'frame', a: 'frame', r: 'rectangle', o: 'ellipse', t: 'text', h: 'hand' }

type State = { tool: Tool; editingText: string | null; gestureOpen: boolean }

let state: State = { tool: 'move', editingText: null, gestureOpen: false }
const listeners = new Set<() => void>()

function set(next: Partial<State>): void {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export const getToolState = () => state
export const setTool = (tool: Tool) => set({ tool })
export const startTextEdit = (id: string, gestureOpen = false) => set({ editingText: id, tool: 'move', gestureOpen })
export const stopTextEdit = () => set({ editingText: null, gestureOpen: false })

export function subscribeTool(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useToolState(): State {
  return useSyncExternalStore(subscribeTool, () => state)
}
