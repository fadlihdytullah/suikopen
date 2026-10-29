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
  snapshot: () => HistorySnapshot
  restore: (snapshot: HistorySnapshot) => void
  clear: () => void
}

export type HistorySnapshot = { past: HistoryEntry[]; future: HistoryEntry[] }

export function createHistory(limit = HISTORY_LIMIT): History {
  const past: HistoryEntry[] = []
  const future: HistoryEntry[] = []
  let pending: (HistoryEntry & { inverseChunks: Patch[][] }) | null = null

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

    const { label, forward, inverseChunks } = pending
    pending = null

    if (forward.length === 0) {
      return null
    }

    const entry = { label, forward, inverse: inverseChunks.reverse().flat() }
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
      pending.inverseChunks.push(inverse)
      return true
    },
    open: (label) => {
      close()
      pending = { label, forward: [], inverse: [], inverseChunks: [] }
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
    snapshot: () => ({ past: [...past], future: [...future] }),
    restore: (snapshot) => {
      past.splice(0, past.length, ...snapshot.past.slice(-limit))
      future.splice(0, future.length, ...snapshot.future)
    },
    clear: () => {
      pending = null
      past.length = 0
      future.length = 0
    },
  }
}
