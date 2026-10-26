export type SelectionStore = {
  getState: () => ReadonlySet<string>
  subscribe: (listener: () => void) => () => void
  set: (ids: Iterable<string>) => void
  toggle: (id: string) => void
  clear: () => void
}

export function createSelectionStore(): SelectionStore {
  let current: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()

  function commit(next: Set<string>): void {
    if (next.size === current.size && [...next].every((id) => current.has(id))) {
      return
    }
    current = next
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    getState: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (ids) => commit(new Set(ids)),
    toggle: (id) => {
      const next = new Set(current)
      if (!next.delete(id)) {
        next.add(id)
      }
      commit(next)
    },
    clear: () => commit(new Set()),
  }
}
