import type { MenuCommand } from '../../main/menu'
import { hasChildren, NodeSchema, type Node } from '../../shared/schema/node'
import { sceneItems, unionBounds, type SceneItem } from '../canvas/scene-index'
import { requestZoom } from '../canvas/viewport-ref'
import type { DocumentStore } from '../store/document-store'
import {
  arrangeNodes,
  duplicateNodes,
  pasteNodes,
  removeNodes,
  unwrapNodes,
  wrapNodes,
  type Arrange,
  type ClipboardEntry,
} from '../store/mutations'
import type { SelectionStore } from '../store/selection'

const OFFSET = 10
const CLIPBOARD_KIND = 'suikopen/nodes'

export function editing(): boolean {
  const focused = document.activeElement as HTMLElement | null
  return !!focused && (focused.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName))
}

export function createEditCommands(store: DocumentStore, selection: SelectionStore) {
  function raw(): Map<string, SceneItem> {
    return new Map(sceneItems(store.getState()).map((item) => [item.node.id, item]))
  }

  function topLevelSelection(): SceneItem[] {
    const items = raw()
    const chosen = selection.getState()
    const covered = (item: SceneItem): boolean => {
      let parent = item.parentId
      while (parent) {
        if (chosen.has(parent)) return true
        parent = items.get(parent)?.parentId ?? null
      }
      return false
    }
    return [...chosen].map((id) => items.get(id)).filter((item): item is SceneItem => !!item && !covered(item))
  }

  function origin(parentId: string | null, items: Map<string, SceneItem>): { x: number; y: number } {
    const parent = parentId ? items.get(parentId) : undefined
    return parent ? { x: parent.x, y: parent.y } : { x: 0, y: 0 }
  }

  function wrap(kind: 'group' | 'frame'): void {
    const items = raw()
    const chosen = topLevelSelection()
    const parentId = chosen[0]?.parentId ?? null
    const members = chosen.filter((item) => item.parentId === parentId)
    const bounds = unionBounds(members)
    if (!bounds || members.length === 0) return
    const absolutes = new Map<string, { x: number; y: number }>()
    for (const member of members) absolutes.set(member.node.id, { x: member.x, y: member.y })
    const id = wrapNodes(
      store,
      members.map((member) => member.node.id),
      kind,
      bounds,
      origin(parentId, items),
      absolutes
    )
    if (id) selection.set([id])
  }

  function unwrap(): void {
    const items = raw()
    const targets = topLevelSelection().filter((item) => (item.node.type === 'group' || item.node.type === 'frame') && hasChildren(item.node))
    if (targets.length === 0) return
    const origins = new Map<string, { x: number; y: number }>()
    const absolutes = new Map<string, { x: number; y: number }>()
    for (const target of targets) {
      origins.set(target.node.id, origin(target.parentId, items))
      if (hasChildren(target.node)) {
        for (const child of target.node.children) {
          const item = items.get(child.id)
          if (item) absolutes.set(child.id, { x: item.x, y: item.y })
        }
      }
    }
    selection.set(unwrapNodes(store, targets.map((target) => target.node.id), origins, absolutes))
  }

  function entries(): ClipboardEntry[] {
    return topLevelSelection().map((item) => ({ node: item.node, absolute: { x: item.x, y: item.y } }))
  }

  function paste(data: string): void {
    let parsed: { kind?: string; entries?: { node: unknown; absolute: { x: number; y: number } }[] }
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (parsed.kind !== CLIPBOARD_KIND || !Array.isArray(parsed.entries)) return
    const valid: ClipboardEntry[] = []
    for (const entry of parsed.entries) {
      const result = NodeSchema.safeParse(entry.node)
      if (result.success && typeof entry.absolute?.x === 'number' && typeof entry.absolute?.y === 'number') {
        valid.push({ node: result.data as Node, absolute: entry.absolute })
      }
    }
    if (valid.length === 0) return
    const items = raw()
    const chosen = [...selection.getState()]
    const target = chosen.length === 1 ? items.get(chosen[0]!) : undefined
    const intoTarget = target && target.node.type === 'frame' ? target : undefined
    const created = pasteNodes(store, valid, intoTarget?.node.id ?? null, intoTarget ? { x: intoTarget.x, y: intoTarget.y } : { x: 0, y: 0 }, intoTarget ? 0 : OFFSET)
    selection.set(created)
  }

  function run(command: MenuCommand): void {
    if (editing()) return
    const ids = topLevelSelection().map((item) => item.node.id)
    const arrange: Partial<Record<MenuCommand, Arrange>> = {
      'bring-forward': 'forward',
      'send-backward': 'backward',
      'bring-to-front': 'front',
      'send-to-back': 'back',
    }
    if (command === 'zoom-in' || command === 'zoom-out') {
      requestZoom(command === 'zoom-in' ? 'in' : 'out')
    } else if (command === 'duplicate' && ids.length) {
      selection.set(duplicateNodes(store, ids, OFFSET))
    } else if (command === 'group') {
      wrap('group')
    } else if (command === 'frame-selection') {
      wrap('frame')
    } else if (command === 'ungroup') {
      unwrap()
    } else if (arrange[command] && ids.length) {
      arrangeNodes(store, ids, arrange[command])
    }
  }

  function onCopy(event: ClipboardEvent, cut: boolean): void {
    if (editing() || selection.getState().size === 0) return
    const payload = entries()
    if (payload.length === 0) return
    event.preventDefault()
    event.clipboardData?.setData('text/plain', JSON.stringify({ kind: CLIPBOARD_KIND, entries: payload }))
    if (cut) {
      removeNodes(store, new Set(payload.map((entry) => entry.node.id)))
      selection.clear()
    }
  }

  const copy = (event: ClipboardEvent) => onCopy(event, false)
  const cut = (event: ClipboardEvent) => onCopy(event, true)
  const onPaste = (event: ClipboardEvent) => {
    if (editing()) return
    const data = event.clipboardData?.getData('text/plain')
    if (data) {
      event.preventDefault()
      paste(data)
    }
  }

  document.addEventListener('copy', copy)
  document.addEventListener('cut', cut)
  document.addEventListener('paste', onPaste)
  const offMenu = window.suikopen.onMenuCommand(run)

  return () => {
    document.removeEventListener('copy', copy)
    document.removeEventListener('cut', cut)
    document.removeEventListener('paste', onPaste)
    offMenu()
  }
}
