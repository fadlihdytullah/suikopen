import { applyPatches, enablePatches, produceWithPatches, type Draft } from 'immer'
import type { Document } from '../../shared/schema/document'
import type { MemoryNote } from '../../shared/schema/memory'
import { createHistory, type History } from './history'

enablePatches()

export type Recipe = (draft: Draft<Document>) => void
export type Listener = () => void

export type DocumentStore = {
  getState: () => Document
  subscribe: (listener: Listener) => () => void
  apply: (label: string | null, recipe: Recipe) => void
  beginGesture: (label: string) => void
  endGesture: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  onGestureEnd: (listener: Listener) => () => void
  setMemory: (update: (notes: MemoryNote[]) => MemoryNote[]) => void
  history: History
}

export function createDocumentStore(initial: Document): DocumentStore {
  let current = initial
  const listeners = new Set<Listener>()
  const gestureListeners = new Set<Listener>()
  const history = createHistory()

  function set(next: Document): void {
    if (next === current) {
      return
    }
    current = next
    for (const listener of listeners) {
      listener()
    }
  }

  function apply(label: string | null, recipe: Recipe): void {
    const [next, forward, inverse] = produceWithPatches(current, recipe)

    if (forward.length === 0) {
      return
    }

    if (!history.append(forward, inverse)) {
      history.push({ label: label ?? 'Edit', forward, inverse })
    }

    set(next)
  }

  return {
    getState: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    apply,
    beginGesture: (label) => history.open(label),
    endGesture: () => {
      history.close()
      for (const listener of gestureListeners) {
        listener()
      }
    },
    undo: () => {
      const entry = history.undo()
      if (entry) {
        set(applyPatches(current, entry.inverse))
      }
    },
    redo: () => {
      const entry = history.redo()
      if (entry) {
        set(applyPatches(current, entry.forward))
      }
    },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    onGestureEnd: (listener) => {
      gestureListeners.add(listener)
      return () => gestureListeners.delete(listener)
    },
    setMemory: (update) => {
      const memory = update([...(current.memory ?? [])])
      set(memory.length ? { ...current, memory } : withoutMemory(current))
    },
    history,
  }
}

function withoutMemory(document: Document): Document {
  if (!document.memory) {
    return document
  }
  const { memory: _memory, ...rest } = document
  return rest
}
