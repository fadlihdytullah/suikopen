import type { Draft } from 'immer'
import type { Document } from '../../shared/schema/document'
import { hasChildren, type Node } from '../../shared/schema/node'
import type { DocumentStore } from './document-store'

export type NodePatch = { x?: number; y?: number; width?: number; height?: number }

function findDraft(nodes: Draft<Node>[], id: string): Draft<Node> | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    if (hasChildren(node as Node)) {
      const found = findDraft((node as Draft<Node> & { children: Draft<Node>[] }).children, id)
      if (found) {
        return found
      }
    }
  }
  return undefined
}

function indexPaths(nodes: Node[], ids: ReadonlySet<string>): Map<string, number[]> {
  const found = new Map<string, number[]>()
  const visit = (list: Node[], prefix: number[]) => {
    list.forEach((node, index) => {
      if (found.size === ids.size) {
        return
      }
      const path = [...prefix, index]
      if (ids.has(node.id)) {
        found.set(node.id, path)
      }
      if (hasChildren(node)) {
        visit(node.children, path)
      }
    })
  }
  visit(nodes, [])
  return found
}

function draftsByPath(draft: Draft<Document>, paths: Map<string, number[]>): [string, Draft<Node>][] {
  return [...paths].map(([id, path]) => {
    let list = draft.children as Draft<Node>[]
    let node = list[path[0]!]!
    for (const index of path.slice(1)) {
      list = (node as Draft<Node> & { children: Draft<Node>[] }).children
      node = list[index]!
    }
    return [id, node]
  })
}

export function updateNodes(store: DocumentStore, label: string | null, patches: Map<string, NodePatch>): void {
  if (patches.size === 0) {
    return
  }

  const paths = indexPaths(store.getState().children, new Set(patches.keys()))
  store.apply(label, (draft: Draft<Document>) => {
    for (const [id, node] of draftsByPath(draft, paths)) {
      const patch = patches.get(id)!
      if (patch.x !== undefined) {
        node.x = patch.x
      }
      if (patch.y !== undefined) {
        node.y = patch.y
      }
      if (patch.width !== undefined) {
        node.width = Math.max(0, patch.width)
      }
      if (patch.height !== undefined) {
        node.height = Math.max(0, patch.height)
      }
    }
  })
}

export function removeNodes(store: DocumentStore, ids: ReadonlySet<string>): void {
  if (ids.size === 0) {
    return
  }

  store.apply('Delete', (draft: Draft<Document>) => {
    function prune(nodes: Draft<Node>[]): void {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index]!
        if (ids.has(node.id)) {
          nodes.splice(index, 1)
          continue
        }
        if (hasChildren(node as Node)) {
          prune((node as Draft<Node> & { children: Draft<Node>[] }).children)
        }
      }
    }

    prune(draft.children as Draft<Node>[])
  })
}

export function setNodeProps(
  store: DocumentStore,
  label: string,
  ids: Iterable<string>,
  patch: Record<string, unknown>
): void {
  const targets = [...ids]
  if (targets.length === 0) {
    return
  }

  const paths = indexPaths(store.getState().children, new Set(targets))
  store.apply(label, (draft: Draft<Document>) => {
    for (const [, node] of draftsByPath(draft, paths)) {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
          delete (node as Record<string, unknown>)[key]
        } else {
          ;(node as Record<string, unknown>)[key] = value
        }
      }
    }
  })
}

function freshIds(node: Node, prefix: string): Node {
  const next = { ...node, id: `${prefix}-${node.id.split('/').pop() ?? node.id}` } as Node

  if (!hasChildren(next)) {
    return next
  }

  return { ...next, children: next.children.map((child) => freshIds(child, prefix)) } as Node
}

export function detachInstance(store: DocumentStore, id: string, expanded: Node): void {
  store.apply('Detach instance', (draft: Draft<Document>) => {
    function replace(nodes: Draft<Node>[]): boolean {
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!
        if (node.id === id) {
          nodes[index] = freshIds(expanded, id) as Draft<Node>
          return true
        }
        if (hasChildren(node as Node) && replace((node as Draft<Node> & { children: Draft<Node>[] }).children)) {
          return true
        }
      }
      return false
    }

    replace(draft.children as Draft<Node>[])
  })
}

export type DropTarget = { refId: string; position: 'above' | 'below' | 'inside' }

export function moveNodes(store: DocumentStore, ids: string[], target: DropTarget): void {
  if (ids.length === 0 || ids.includes(target.refId)) {
    return
  }

  store.apply('Move layers', (draft: Draft<Document>) => {
    const containsId = (node: Draft<Node>, id: string): boolean =>
      node.id === id || (hasChildren(node as Node) && (node as Draft<Node> & { children: Draft<Node>[] }).children.some((child) => containsId(child, id)))
    const moving = ids.map((id) => findDraft(draft.children as Draft<Node>[], id)).filter((node): node is Draft<Node> => !!node)
    if (moving.some((node) => containsId(node, target.refId))) {
      return
    }

    const detached: Draft<Node>[] = []
    const prune = (nodes: Draft<Node>[]) => {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index]!
        if (ids.includes(node.id)) {
          detached.unshift(nodes.splice(index, 1)[0]!)
        } else if (hasChildren(node as Node)) {
          prune((node as Draft<Node> & { children: Draft<Node>[] }).children)
        }
      }
    }
    prune(draft.children as Draft<Node>[])

    const siblingsOf = (nodes: Draft<Node>[]): Draft<Node>[] | undefined => {
      if (nodes.some((node) => node.id === target.refId)) {
        return nodes
      }
      for (const node of nodes) {
        if (hasChildren(node as Node)) {
          const found = siblingsOf((node as Draft<Node> & { children: Draft<Node>[] }).children)
          if (found) {
            return found
          }
        }
      }
      return undefined
    }

    if (target.position === 'inside') {
      const parent = findDraft(draft.children as Draft<Node>[], target.refId)
      if (parent && hasChildren(parent as Node)) {
        ;(parent as Draft<Node> & { children: Draft<Node>[] }).children.push(...detached)
      }
      return
    }

    const siblings = siblingsOf(draft.children as Draft<Node>[])
    if (!siblings) {
      return
    }
    const index = siblings.findIndex((node) => node.id === target.refId)
    siblings.splice(target.position === 'above' ? index + 1 : index, 0, ...detached)
  })
}

type Container = Draft<Node> & { children: Draft<Node>[] }
type Point = { x: number; y: number }
type Bounds = Point & { width: number; height: number }

export type ClipboardEntry = { node: Node; absolute: Point }

export function newId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function withFreshIds(node: Node): Node {
  const next = { ...node, id: newId() } as Node
  return hasChildren(next) ? ({ ...next, children: next.children.map(withFreshIds) } as Node) : next
}

function siblingsOf(nodes: Draft<Node>[], id: string): Draft<Node>[] | undefined {
  if (nodes.some((node) => node.id === id)) {
    return nodes
  }
  for (const node of nodes) {
    if (hasChildren(node as Node)) {
      const found = siblingsOf((node as Container).children, id)
      if (found) {
        return found
      }
    }
  }
  return undefined
}

function childrenOf(draft: Draft<Document>, parentId: string | null): Draft<Node>[] | undefined {
  if (parentId === null) {
    return draft.children as Draft<Node>[]
  }
  const parent = findDraft(draft.children as Draft<Node>[], parentId)
  return parent && hasChildren(parent as Node) ? (parent as Container).children : undefined
}

export function insertNode(store: DocumentStore, label: string, parentId: string | null, node: Node): boolean {
  let inserted = false
  store.apply(label, (draft) => {
    const children = childrenOf(draft, parentId)
    if (children) {
      children.push(node as Draft<Node>)
      inserted = true
    }
  })
  return inserted
}

export function duplicateNodes(store: DocumentStore, ids: string[], offset: number): string[] {
  const created: string[] = []
  store.apply('Duplicate', (draft) => {
    for (const id of ids) {
      const siblings = siblingsOf(draft.children as Draft<Node>[], id)
      const index = siblings?.findIndex((node) => node.id === id) ?? -1
      if (!siblings || index < 0) {
        continue
      }
      const copy = withFreshIds(JSON.parse(JSON.stringify(siblings[index])) as Node)
      copy.x += offset
      copy.y += offset
      siblings.splice(index + 1, 0, copy as Draft<Node>)
      created.push(copy.id)
    }
  })
  return created
}

export function pasteNodes(store: DocumentStore, entries: ClipboardEntry[], parentId: string | null, origin: Point, offset: number): string[] {
  const created: string[] = []
  store.apply('Paste', (draft) => {
    const children = childrenOf(draft, parentId)
    if (!children) {
      return
    }
    for (const entry of entries) {
      const copy = withFreshIds(entry.node)
      copy.x = entry.absolute.x - origin.x + offset
      copy.y = entry.absolute.y - origin.y + offset
      children.push(copy as Draft<Node>)
      created.push(copy.id)
    }
  })
  return created
}

export function wrapNodes(
  store: DocumentStore,
  ids: string[],
  kind: 'group' | 'frame',
  bounds: Bounds,
  parentOrigin: Point,
  absolutes: Map<string, Point>
): string | null {
  const wrapperId = newId()
  let wrapped = false
  store.apply(kind === 'group' ? 'Group' : 'Frame selection', (draft) => {
    const siblings = siblingsOf(draft.children as Draft<Node>[], ids[0]!)
    if (!siblings) {
      return
    }
    const indices = ids.map((id) => siblings.findIndex((node) => node.id === id)).filter((index) => index >= 0)
    if (indices.length === 0) {
      return
    }
    const top = Math.max(...indices)
    const members = [...indices].sort((a, b) => a - b).map((index) => siblings[index]!)
    for (const member of members) {
      const absolute = absolutes.get(member.id) ?? { x: member.x, y: member.y }
      member.x = absolute.x - bounds.x
      member.y = absolute.y - bounds.y
    }
    const wrapper = {
      id: wrapperId,
      type: kind,
      x: bounds.x - parentOrigin.x,
      y: bounds.y - parentOrigin.y,
      width: bounds.width,
      height: bounds.height,
      children: members,
    } as unknown as Draft<Node>
    const removed = new Set(members.map((member) => member.id))
    const insertAt = top - members.filter((member) => siblings.indexOf(member) < top).length
    for (let index = siblings.length - 1; index >= 0; index -= 1) {
      if (removed.has(siblings[index]!.id)) {
        siblings.splice(index, 1)
      }
    }
    siblings.splice(insertAt, 0, wrapper)
    wrapped = true
  })
  return wrapped ? wrapperId : null
}

export function unwrapNodes(store: DocumentStore, ids: string[], parentOrigins: Map<string, Point>, absolutes: Map<string, Point>): string[] {
  const released: string[] = []
  store.apply('Ungroup', (draft) => {
    for (const id of ids) {
      const siblings = siblingsOf(draft.children as Draft<Node>[], id)
      const index = siblings?.findIndex((node) => node.id === id) ?? -1
      const wrapper = siblings?.[index]
      if (!siblings || !wrapper || !hasChildren(wrapper as Node)) {
        continue
      }
      const origin = parentOrigins.get(id) ?? { x: 0, y: 0 }
      const children = (wrapper as Container).children
      for (const child of children) {
        const absolute = absolutes.get(child.id) ?? { x: child.x, y: child.y }
        child.x = absolute.x - origin.x
        child.y = absolute.y - origin.y
        released.push(child.id)
      }
      siblings.splice(index, 1, ...children)
    }
  })
  return released
}

export type Arrange = 'forward' | 'backward' | 'front' | 'back'

export function arrangeNodes(store: DocumentStore, ids: string[], direction: Arrange): void {
  const chosen = new Set(ids)
  const labels: Record<Arrange, string> = { forward: 'Bring forward', backward: 'Send backward', front: 'Bring to front', back: 'Send to back' }
  store.apply(labels[direction], (draft) => {
    const groups = new Set<Draft<Node>[]>()
    for (const id of ids) {
      const siblings = siblingsOf(draft.children as Draft<Node>[], id)
      if (siblings) {
        groups.add(siblings)
      }
    }
    for (const siblings of groups) {
      const picked = siblings.filter((node) => chosen.has(node.id))
      const rest = siblings.filter((node) => !chosen.has(node.id))
      if (direction === 'front' || direction === 'back') {
        siblings.splice(0, siblings.length, ...(direction === 'front' ? [...rest, ...picked] : [...picked, ...rest]))
        continue
      }
      if (direction === 'forward') {
        for (let index = siblings.length - 2; index >= 0; index -= 1) {
          if (chosen.has(siblings[index]!.id) && !chosen.has(siblings[index + 1]!.id)) {
            ;[siblings[index], siblings[index + 1]] = [siblings[index + 1]!, siblings[index]!]
          }
        }
      } else {
        for (let index = 1; index < siblings.length; index += 1) {
          if (chosen.has(siblings[index]!.id) && !chosen.has(siblings[index - 1]!.id)) {
            ;[siblings[index], siblings[index - 1]] = [siblings[index - 1]!, siblings[index]!]
          }
        }
      }
    }
  })
}
