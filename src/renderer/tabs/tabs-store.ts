import { useSyncExternalStore } from 'react'
import type { Document, ThemeSelection } from '../../shared/schema/document'
import { createPresence, type Presence } from '../agent/presence'
import type { Viewport } from '../canvas/viewport'
import { activeTheme, setActiveTheme } from '../document/resolved'
import { createDocumentStore, type DocumentStore } from '../store/document-store'
import { createMutationQueue, type MutationQueue } from '../store/mutation-queue'
import { createSelectionStore, type SelectionStore } from '../store/selection'

export type Tab = {
  id: string
  store: DocumentStore
  selection: SelectionStore
  queue: MutationQueue
  presence: Presence
  path: string | null
  assetBase: string | null
  saved: Document | null
  viewport: Viewport | null
  theme: ThemeSelection
  pinned: boolean
  asleep: boolean
  inactiveSince: number
  chatId?: string | null
}

export type TabInput = { id: string; document: Document; path: string | null; assetBase: string | null; recovered?: boolean }

export type TabsState = { tabs: readonly Tab[]; activeId: string | null }

export function isDirty(tab: Tab): boolean {
  return tab.store.getState() !== tab.saved
}

export function isPristine(tab: Tab): boolean {
  return tab.path === null && !isDirty(tab)
}

export function tabName(tab: Tab): string {
  const file = tab.path?.split(/[\\/]/).pop()
  return file ? file.replace(/\.spen$/i, '') : 'Untitled'
}

export function tabLabels(list: readonly Tab[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const tab of list) {
    counts.set(tabName(tab), (counts.get(tabName(tab)) ?? 0) + 1)
  }
  return new Map(
    list.map((tab) => {
      const name = tabName(tab)
      const folder = tab.path?.split(/[\\/]/).slice(-2, -1)[0]
      return [tab.id, (counts.get(name) ?? 0) > 1 && folder ? `${name} — ${folder}` : name]
    })
  )
}

export function middleEllipsis(text: string, max = 28): string {
  if (text.length <= max) {
    return text
  }
  const head = Math.ceil((max - 1) / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`
}

let switchedAt = 0

export function takeSwitchDuration(now: number): number | null {
  if (!switchedAt) {
    return null
  }
  const duration = now - switchedAt
  switchedAt = 0
  return duration
}

export type TabsStore = ReturnType<typeof createTabsStore>

export function createTabsStore(theme: { get: () => ThemeSelection; set: (next: ThemeSelection) => void } = { get: activeTheme, set: setActiveTheme }) {
  let state: TabsState = { tabs: [], activeId: null }
  const listeners = new Set<() => void>()
  const unsubscribers = new Map<string, () => void>()

  function emit(next: Partial<TabsState> = {}): void {
    state = { ...state, ...next }
    for (const listener of listeners) {
      listener()
    }
  }

  function find(id: string | null): Tab | undefined {
    return state.tabs.find((tab) => tab.id === id)
  }

  function create(input: TabInput): Tab {
    const store = createDocumentStore(input.document)
    const tab: Tab = {
      id: input.id,
      store,
      selection: createSelectionStore(),
      queue: createMutationQueue(store),
      presence: createPresence(),
      path: input.path,
      assetBase: input.assetBase,
      saved: input.recovered ? null : input.document,
      viewport: null,
      theme: {},
      pinned: false,
      asleep: false,
      inactiveSince: 0,
    }
    let dirty = isDirty(tab)
    unsubscribers.set(
      tab.id,
      store.subscribe(() => {
        if (isDirty(tab) !== dirty) {
          dirty = !dirty
          emit()
        }
      })
    )
    return tab
  }

  function activate(id: string): void {
    const next = find(id)
    if (!next || id === state.activeId) {
      return
    }
    const current = find(state.activeId)
    if (current) {
      current.theme = theme.get()
      current.inactiveSince = performance.now()
    }
    theme.set(next.theme)
    switchedAt = performance.now()
    emit({ activeId: id })
  }

  function dispose(tab: Tab): void {
    unsubscribers.get(tab.id)?.()
    unsubscribers.delete(tab.id)
    tab.queue.dispose()
  }

  return {
    getState: (): TabsState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    active: (): Tab | undefined => find(state.activeId),
    get: find,
    open(input: TabInput): Tab {
      const existing = find(input.id)
      if (existing) {
        activate(existing.id)
        return existing
      }
      const tab = create(input)
      const pinnedCount = state.tabs.filter((entry) => entry.pinned).length
      const index = state.tabs.findIndex((entry) => entry.id === state.activeId)
      const tabs = [...state.tabs]
      tabs.splice(Math.max(index + 1, pinnedCount), 0, tab)
      state = { ...state, tabs }
      activate(tab.id)
      return tab
    },
    replace(id: string, input: TabInput): Tab {
      const old = find(id)
      if (!old) {
        throw new Error(`No tab "${id}".`)
      }
      const tab = create(input)
      dispose(old)
      const tabs = state.tabs.map((entry) => (entry.id === id ? tab : entry))
      const wasActive = state.activeId === id
      state = { ...state, tabs, activeId: wasActive ? null : state.activeId }
      if (wasActive) {
        theme.set(tab.theme)
        emit({ activeId: tab.id })
      } else {
        emit()
      }
      return tab
    },
    close(id: string): void {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      const tab = state.tabs[index]
      if (!tab) {
        return
      }
      dispose(tab)
      const tabs = state.tabs.filter((entry) => entry.id !== id)
      if (state.activeId !== id) {
        emit({ tabs })
        return
      }
      const neighbour = tabs[Math.min(index, tabs.length - 1)] ?? null
      state = { ...state, tabs, activeId: null }
      if (neighbour) {
        theme.set(neighbour.theme)
      }
      emit({ activeId: neighbour?.id ?? null })
    },
    activate,
    cycle(step: number): void {
      const count = state.tabs.length
      if (count < 2) {
        return
      }
      const index = state.tabs.findIndex((tab) => tab.id === state.activeId)
      activate(state.tabs[(index + step + count) % count]!.id)
    },
    move(id: string, index: number): void {
      const tab = find(id)
      if (!tab) {
        return
      }
      const rest = state.tabs.filter((entry) => entry !== tab)
      const pinnedCount = rest.filter((entry) => entry.pinned).length
      const bounded = tab.pinned ? Math.min(Math.max(0, index), pinnedCount) : Math.min(Math.max(pinnedCount, index), rest.length)
      rest.splice(bounded, 0, tab)
      emit({ tabs: rest })
    },
    togglePin(id: string): void {
      const tab = find(id)
      if (!tab) {
        return
      }
      tab.pinned = !tab.pinned
      const pinned = state.tabs.filter((entry) => entry.pinned)
      const loose = state.tabs.filter((entry) => !entry.pinned)
      emit({ tabs: [...pinned, ...loose] })
    },
    markSaved(id: string, document: Document, path: string): void {
      const tab = find(id)
      if (!tab) {
        return
      }
      tab.saved = document
      tab.path = path
      tab.assetBase = path
      emit()
    },
  }
}

export const tabs = createTabsStore()

export function useTabs(): TabsState {
  return useSyncExternalStore(tabs.subscribe, tabs.getState)
}

export function useActiveTab(): Tab | undefined {
  const state = useTabs()
  return state.tabs.find((tab) => tab.id === state.activeId)
}
