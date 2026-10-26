import type { Patch } from 'immer'

export const HISTORY_LIMIT = 200

export type HistoryEntry = { label: string; forward: Patch[]; inverse: Patch[] }

export type History = {
  push: (entry: HistoryEntry) => void
  append: (forward: Patch[], inverse: Patch[]) => boolean
  open: (label: string) => void
  close: () => HistoryEntry | null
  undo: () => HistoryEntry | null
  redo: () => HistoryEntry | null
  canUndo: () => boolean
  canRedo: () => boolean
  isOpen: () => boolean
  depth: () => { past: number; future: number }
}

export function createHistory(limit = HISTORY_LIMIT): History {
  const past: HistoryEntry[] = []
  const future: HistoryEntry[] = []
  let pending: HistoryEntry | null = null

  function commit(entry: HistoryEntry): void {
    past.push(entry)
    future.length = 0
    if (past.length > limit) {
      past.splice(0, past.length - limit)
    }
  }

  function close(): HistoryEntry | null {
    if (!pending) {
      return null
    }

    const entry = pending
    pending = null

    if (entry.forward.length === 0) {
      return null
    }

    commit(entry)
    return entry
  }

  return {
    push: (entry) => {
      close()
      if (entry.forward.length > 0) {
        commit(entry)
      }
    },
    append: (forward, inverse) => {
      if (!pending || forward.length === 0) {
        return false
      }
      pending.forward.push(...forward)
      pending.inverse.unshift(...inverse)
      return true
    },
    open: (label) => {
      close()
      pending = { label, forward: [], inverse: [] }
    },
    close,
    undo: () => {
      close()
      const entry = past.pop()
      if (!entry) {
        return null
      }
      future.push(entry)
      return entry
    },
    redo: () => {
      const entry = future.pop()
      if (!entry) {
        return null
      }
      past.push(entry)
      return entry
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    isOpen: () => pending !== null,
    depth: () => ({ past: past.length, future: future.length }),
  }
}
