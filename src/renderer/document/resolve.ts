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
    const next = value.map((entry) => resolveValue(entry, variables, theme))
    return next.every((entry, index) => entry === value[index]) ? value : next
  }

  if (value !== null && typeof value === 'object') {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const resolvedEntry = key === 'id' || key === 'masterId' ? entry : resolveValue(entry, variables, theme)
      changed ||= resolvedEntry !== entry
      next[key] = resolvedEntry
    }
    return changed ? next : value
  }

  return value
}

let valueMemo = { variables: null as Record<string, Variable> | null, themeKey: '', nodes: new WeakMap<Node, Node>() }

function resolveNodes(nodes: Node[], variables: Record<string, Variable>, theme: ThemeSelection): Node[] {
  const themeKey = JSON.stringify(theme)
  if (valueMemo.variables !== variables || valueMemo.themeKey !== themeKey) {
    valueMemo = { variables, themeKey, nodes: new WeakMap() }
  }
  const memo = valueMemo.nodes

  const visit = (list: Node[]): Node[] => {
    const next = list.map((node) => {
      const cached = memo.get(node)
      if (cached) {
        return cached
      }
      let changed = false
      const out: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(node)) {
        const resolvedEntry =
          key === 'children' ? visit(entry as Node[]) : key === 'id' || key === 'masterId' ? entry : resolveValue(entry, variables, theme)
        changed ||= resolvedEntry !== entry
        out[key] = resolvedEntry
      }
      const result = changed ? (out as Node) : node
      memo.set(node, result)
      return result
    })
    return same(list, next)
  }

  return visit(nodes)
}

function same<T>(previous: T[], next: T[]): T[] {
  return previous.length === next.length && next.every((entry, index) => entry === previous[index]) ? previous : next
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

type Expansion = { deps: Node[]; result: Node }

const expansions = new WeakMap<Node, Expansion>()

function expand(nodes: Node[], masters: Map<string, Node>, visiting: Set<string>, depth: number, deps: Node[]): Node[] {
  const next = nodes.flatMap((node): Node[] => {
    if (node.type !== 'ref') {
      if (hasChildren(node)) {
        const children = expand(node.children, masters, visiting, depth, deps)
        return [children === node.children ? node : ({ ...node, children } as Node)]
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

    const cached = expansions.get(node)
    if (cached && cached.deps.every((dep) => masters.get(dep.id) === dep)) {
      deps.push(...cached.deps)
      return [cached.result]
    }

    const overridden = applyOverrides(master, master.id, node.overrides ?? {})
    const placed = {
      ...namespace(overridden, node.id),
      id: node.id,
      x: node.x,
      y: node.y,
    } as Node

    const own: Node[] = [master]
    visiting.add(node.masterId)
    const [result] = expand([placed], masters, visiting, depth + 1, own)
    visiting.delete(node.masterId)

    if (!result) {
      return []
    }
    expansions.set(node, { deps: own, result })
    deps.push(...own)
    return [result]
  })

  return same(nodes, next)
}

function dropHidden(nodes: Node[]): Node[] {
  const visible = nodes.filter((node) => node.visible !== false)
  const next = visible.map((node) => {
    if (!hasChildren(node)) {
      return node
    }
    const children = dropHidden(node.children)
    return children === node.children ? node : ({ ...node, children } as Node)
  })
  return same(nodes, next)
}

export type ResolveResult = { document: Document; error: string | null }

export function resolveDocument(document: Document, theme: ThemeSelection = {}): ResolveResult {
  const variables = document.variables ?? {}
  const hasVariables = Object.keys(variables).length > 0
  const values = hasVariables ? resolveNodes(document.children, variables, theme) : document.children

  const masters = new Map<string, Node>()
  collectMasters(values, masters)

  const finish = (children: Node[]): Document =>
    !hasVariables && children === document.children ? document : { ...document, variables: undefined, children }

  try {
    return { document: finish(dropHidden(expand(values, masters, new Set(), 0, []))), error: null }
  } catch (error) {
    return { document: finish(dropHidden(values)), error: (error as Error).message }
  }
}
