import { useSyncExternalStore } from 'react'

let current: string | null = null
const listeners = new Set<() => void>()

export function setDocumentPath(path: string | null): void {
  if (path === current) return
  current = path
  listeners.forEach((listener) => listener())
}

export function useDocumentPath(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
}
