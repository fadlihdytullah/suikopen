import type { Document } from '../../shared/schema/document'
import { hasChildren, type Node, type ParentNode } from '../../shared/schema/node'
import { computeLayout, type LayoutMap } from '../layout/yoga-tree'

export type Rect = { x: number; y: number; width: number; height: number }
export type SceneItem = Rect & { node: Node; parent: ParentNode | null; parentId: string | null; depth: number; locked: boolean }

let cache = new WeakMap<Document, SceneItem[]>()
let layouts = new WeakMap<Document, LayoutMap>()
let itemIndex = new WeakMap<Document, Map<string, SceneItem>>()
let nodeIndex = new WeakMap<Document, Map<string, Node>>()
const parentIndex = new WeakMap<SceneItem[], Map<string, string | null>>()

export function invalidateSceneCaches(): void {
  cache = new WeakMap()
  layouts = new WeakMap()
  itemIndex = new WeakMap()
  nodeIndex = new WeakMap()
}

export function layoutOf(document: Document): LayoutMap {
  let layout = layouts.get(document)
  if (!layout) {
    layout = computeLayout(document)
    layouts.set(document, layout)
  }
  return layout
}

export function sceneItems(document: Document): SceneItem[] {
  const cached = cache.get(document)
  if (cached) {
    return cached
  }

  const layout = layoutOf(document)
  const items: SceneItem[] = []

  function visit(nodes: Node[], parent: ParentNode | null, depth: number, lockedParent: boolean): void {
    for (const node of nodes) {
      const rect = layout.get(node.id) ?? { x: node.x, y: node.y, width: 0, height: 0 }
      const locked = lockedParent || node.locked === true
      items.push({ node, parent, parentId: parent?.id ?? null, depth, locked, ...rect })
      if (hasChildren(node)) {
        visit(node.children, node, depth + 1, locked)
      }
    }
  }

  visit(document.children, null, 0, false)
  cache.set(document, items)

  return items
}

export function itemById(document: Document, id: string): SceneItem | undefined {
  let index = itemIndex.get(document)
  if (!index) {
    index = new Map(sceneItems(document).map((item) => [item.node.id, item]))
    itemIndex.set(document, index)
  }
  return index.get(id)
}

export function nodeById(document: Document, id: string): Node | undefined {
  let index = nodeIndex.get(document)
  if (!index) {
    const built = new Map<string, Node>()
    const visit = (nodes: Node[]) => {
      for (const node of nodes) {
        built.set(node.id, node)
        if (hasChildren(node)) {
          visit(node.children)
        }
      }
    }
    visit(document.children)
    index = built
    nodeIndex.set(document, index)
  }
  return index.get(id)
}

export function parentChain(items: SceneItem[], id: string): string[] {
  let parents = parentIndex.get(items)
  if (!parents) {
    parents = new Map(items.map((item) => [item.node.id, item.parentId]))
    parentIndex.set(items, parents)
  }
  const chain: string[] = []
  let current = parents.get(id) ?? null

  while (current) {
    chain.push(current)
    current = parents.get(current) ?? null
  }

  return chain
}

export function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
  )
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function within(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

export function unionBounds(rects: Rect[]): Rect | null {
  if (rects.length === 0) {
    return null
  }

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const rect of rects) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}
