import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Document } from '../../shared/schema/document'
import type { DocumentStore } from './document-store'
import type { SelectionStore } from './selection'

const StoreContext = createContext<DocumentStore | null>(null)
const SelectionContext = createContext<SelectionStore | null>(null)

export const DocumentStoreProvider = StoreContext.Provider
export const SelectionStoreProvider = SelectionContext.Provider

export function useDocumentStore(): DocumentStore {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error('useDocumentStore must be used inside a DocumentStoreProvider')
  }
  return store
}

export function useSelectionStore(): SelectionStore {
  const selection = useContext(SelectionContext)
  if (!selection) {
    throw new Error('useSelectionStore must be used inside a SelectionStoreProvider')
  }
  return selection
}

export function useDocument(): Document {
  const store = useDocumentStore()
  return useSyncExternalStore(store.subscribe, store.getState)
}

export function useSelection(): ReadonlySet<string> {
  const selection = useSelectionStore()
  return useSyncExternalStore(selection.subscribe, selection.getState)
}
