import { hasChildren, type Node, type ParentNode } from '../schema/node'
import type { Document } from '../schema/document'

export type IndexEntry = { node: Node; parent: ParentNode | null }
export type DocumentIndex = Map<string, IndexEntry>

export function buildIndex(document: Document): DocumentIndex {
  const index: DocumentIndex = new Map()

  function visit(nodes: Node[], parent: ParentNode | null): void {
    for (const node of nodes) {
      if (index.has(node.id)) {
        throw new Error(`Duplicate node id "${node.id}".`)
      }
      index.set(node.id, { node, parent })
      if (hasChildren(node)) {
        visit(node.children, node)
      }
    }
  }

  visit(document.children, null)

  return index
}
