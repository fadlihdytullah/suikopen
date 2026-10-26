import type { Document, ThemeSelection, Variable } from '../../shared/schema/document'
import { hasChildren, type Node } from '../../shared/schema/node'

export const MAX_INSTANCE_DEPTH = 16

function pickVariable(variable: Variable, theme: ThemeSelection): unknown {
  const value = variable.value

  if (!Array.isArray(value)) {
    return value
  }

  const matching = value.find(
    (candidate) =>
      candidate.theme !== undefined &&
      Object.entries(candidate.theme).every(([axis, option]) => theme[axis] === option)
  )

  return (matching ?? value.find((candidate) => candidate.theme === undefined) ?? value[0])?.value
}

export function resolveValue(value: unknown, variables: Record<string, Variable>, theme: ThemeSelection): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const variable = variables[value.slice(1)]
    return variable ? pickVariable(variable, theme) : value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, variables, theme))
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        key === 'id' || key === 'masterId' ? entry : resolveValue(entry, variables, theme),
      ])
    )
  }

  return value
}

function collectMasters(nodes: Node[], into: Map<string, Node>): void {
  for (const node of nodes) {
    into.set(node.id, node)
    if (hasChildren(node)) {
      collectMasters(node.children, into)
    }
  }
}

function applyOverrides(node: Node, path: string, overrides: Record<string, Record<string, unknown>>): Node {
  const patch = overrides[path]
  const next = patch ? ({ ...node, ...patch, id: node.id } as Node) : node

  if (!hasChildren(next)) {
    return next
  }

  return {
    ...next,
    children: next.children.map((child) => applyOverrides(child, `${path}/${child.id}`, overrides)),
  } as Node
}

function namespace(node: Node, prefix: string): Node {
  const next = { ...node, id: `${prefix}/${node.id}` } as Node

  if (!hasChildren(next)) {
    return next
  }

  return { ...next, children: next.children.map((child) => namespace(child, prefix)) } as Node
}

function expand(nodes: Node[], masters: Map<string, Node>, visiting: Set<string>, depth: number): Node[] {
  return nodes.flatMap((node): Node[] => {
    if (node.type !== 'ref') {
      if (hasChildren(node)) {
        return [{ ...node, children: expand(node.children, masters, visiting, depth) } as Node]
      }
      return [node]
    }

    const master = masters.get(node.masterId)

    if (!master) {
      throw new Error(`Instance "${node.id}" points at missing master "${node.masterId}".`)
    }

    if (visiting.has(node.masterId)) {
      throw new Error(`Component "${node.masterId}" contains itself.`)
    }

    if (depth >= MAX_INSTANCE_DEPTH) {
      throw new Error(`Instances nested deeper than ${MAX_INSTANCE_DEPTH} levels.`)
    }

    const overridden = applyOverrides(master, master.id, node.overrides ?? {})
    const placed = {
      ...namespace(overridden, node.id),
      id: node.id,
      x: node.x,
      y: node.y,
    } as Node

    visiting.add(node.masterId)
    const [result] = expand([placed], masters, visiting, depth + 1)
    visiting.delete(node.masterId)

    return result ? [result] : []
  })
}

function dropHidden(nodes: Node[]): Node[] {
  return nodes
    .filter((node) => node.visible !== false)
    .map((node) => (hasChildren(node) ? ({ ...node, children: dropHidden(node.children) } as Node) : node))
}

export type ResolveResult = { document: Document; error: string | null }

export function resolveDocument(document: Document, theme: ThemeSelection = {}): ResolveResult {
  const variables = document.variables ?? {}
  const withValues = (
    variables && Object.keys(variables).length > 0
      ? (resolveValue({ ...document, variables: undefined }, variables, theme) as Document)
      : document
  )

  const masters = new Map<string, Node>()
  collectMasters(withValues.children, masters)

  try {
    return { document: { ...withValues, children: dropHidden(expand(withValues.children, masters, new Set(), 0)) }, error: null }
  } catch (error) {
    return { document: { ...withValues, children: dropHidden(withValues.children) }, error: (error as Error).message }
  }
}
