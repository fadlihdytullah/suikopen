import type { Document, ThemeSelection } from '../../shared/schema/document'
import { resolveDocument, type ResolveResult } from './resolve'

let theme: ThemeSelection = {}
let themeKey = ''
let cache = new WeakMap<Document, { key: string; result: ResolveResult }>()
let listeners = new Set<() => void>()

export function activeTheme(): ThemeSelection {
  return theme
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setActiveTheme(next: ThemeSelection): void {
  theme = next
  themeKey = JSON.stringify(next)
  cache = new WeakMap()
  for (const listener of listeners) {
    listener()
  }
}

export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetResolvedCache(): void {
  cache = new WeakMap()
  listeners = new Set()
  theme = {}
  themeKey = ''
}

export function resolved(document: Document, selection?: ThemeSelection): ResolveResult {
  const key = selection ? JSON.stringify(selection) : themeKey
  const cached = cache.get(document)
  if (cached && cached.key === key) {
    return cached.result
  }

  const result = resolveDocument(document, selection ?? theme)
  cache.set(document, { key, result })

  return result
}

export function forgetResolved(document: Document): void {
  cache.delete(document)
}
