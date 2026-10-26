import type { AgentRequest, NodeSummary } from '../../shared/mcp/contract'
import { hasChildren, NodeSchema, type Node } from '../../shared/schema/node'
import { itemById, sceneItems, type SceneItem } from '../canvas/scene-index'
import { resolvedDocument } from '../document/current'
import { activeTheme, setActiveTheme } from '../document/resolved'
import { detachInstance } from '../store/mutations'
import { markAgentTouch } from '../agent/presence'
import { currentViewport } from '../canvas/viewport-ref'
import { loadCanvasKit } from '../canvas/canvaskit'
import { renderNodePng } from '../canvas/paint'
import { toScreen } from '../canvas/viewport'
import type { DocumentStore } from '../store/document-store'
import type { MutationQueue } from '../store/mutation-queue'
import { removeNodes, setNodeProps, updateNodes } from '../store/mutations'
import type { SelectionStore } from '../store/selection'

function summarise(item: SceneItem, withChildren = false): NodeSummary {
  const summary: NodeSummary = {
    id: item.node.id,
    type: item.node.type,
    parentId: item.parentId,
    depth: item.depth,
    rect: { x: item.x, y: item.y, width: item.width, height: item.height },
  }

  if (item.node.name !== undefined) {
    summary.name = item.node.name
  }

  if (withChildren && hasChildren(item.node)) {
    summary.childIds = item.node.children.map((child) => child.id)
  }

  return summary
}

function validNode(candidate: unknown): Node {
  const result = NodeSchema.safeParse(candidate)
  if (result.success) {
    return result.data
  }
  const issue = result.error.issues[0]
  const where = issue ? issue.path.map(String).join('.') : ''
  throw new Error(`Invalid node${where ? ` at ${where}` : ''}: ${issue?.message ?? 'does not match the schema'}.`)
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required string parameter "${key}".`)
  }
  return value
}

function ids(params: Record<string, unknown>): string[] {
  const value = params['ids']
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value
  }
  return [requireString(params, 'id')]
}

function insertInto(nodes: Node[], parentId: string | null, child: Node): boolean {
  if (parentId === null) {
    nodes.push(child)
    return true
  }

  for (const node of nodes) {
    if (node.id === parentId && hasChildren(node)) {
      node.children.push(child)
      return true
    }
    if (hasChildren(node) && insertInto(node.children, parentId, child)) {
      return true
    }
  }

  return false
}

export type HandlerContext = {
  store: DocumentStore
  selection: SelectionStore
  queue: MutationQueue
  documentPath: () => string | null
}

export function createAgentHandlers({ store, selection, queue, documentPath }: HandlerContext) {
  function items(): SceneItem[] {
    return sceneItems(resolvedDocument(store))
  }

  function node(id: string): SceneItem {
    const item = itemById(resolvedDocument(store), id)
    if (!item) {
      throw new Error(`No node with id "${id}".`)
    }
    return item
  }

  const read: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>> = {
    get_document_info: () => ({
      path: documentPath(),
      version: store.getState().version,
      nodeCount: items().length,
      rootIds: store.getState().children.map((child) => child.id),
    }),
    get_tree: (params) => {
      const maxDepth = typeof params['maxDepth'] === 'number' ? params['maxDepth'] : 3
      return items()
        .filter((item) => item.depth <= maxDepth)
        .map((item) => summarise(item, true))
    },
    get_node: (params) => {
      const item = node(requireString(params, 'id'))
      return { ...summarise(item, true), node: item.node }
    },
    find_nodes: (params) => {
      const name = typeof params['name'] === 'string' ? params['name'].toLowerCase() : null
      const type = typeof params['type'] === 'string' ? params['type'] : null

      return items()
        .filter((item) => (type === null || item.node.type === type) &&
          (name === null || (item.node.name ?? '').toLowerCase().includes(name)))
        .map((item) => summarise(item))
    },
    get_selection: () => [...selection.getState()].map((id) => summarise(node(id))),
    get_theme: () => ({ axes: store.getState().themes ?? {}, active: activeTheme() }),
    render_node: async (params) => {
      const id = requireString(params, 'id')
      node(id)
      const canvasKit = await loadCanvasKit()
      const png = renderNodePng(canvasKit, resolvedDocument(store), id)
      if (!png) {
        throw new Error(`Could not render "${id}".`)
      }
      return { png }
    },
    get_screen_rect: (params) => {
      const item = node(requireString(params, 'id'))
      const { viewport, origin } = currentViewport()
      const topLeft = toScreen(viewport, { x: item.x, y: item.y })

      return {
        x: Math.round(origin.x + topLeft.x),
        y: Math.round(origin.y + topLeft.y),
        width: Math.round(item.width * viewport.scale),
        height: Math.round(item.height * viewport.scale),
      }
    },
  }

  const write: Record<string, (params: Record<string, unknown>) => unknown> = {
    set_selection: (params) => {
      const next = ids(params)
      next.forEach((id) => node(id))
      selection.set(next)
      return { selected: next }
    },
    update_node: (params) => {
      const id = requireString(params, 'id')
      node(id)
      const props = params['props']
      if (typeof props !== 'object' || props === null) {
        throw new Error('Missing required object parameter "props".')
      }
      const raw = itemById(store.getState(), id)
      if (!raw) {
        throw new Error(`Node "${id}" is inside a component instance; update the master or detach the instance.`)
      }
      validNode({ ...raw.node, ...(props as Record<string, unknown>), id })
      setNodeProps(store, 'Agent update', [id], props as Record<string, unknown>)
      return summarise(node(id))
    },
    move_node: (params) => {
      const id = requireString(params, 'id')
      const item = node(id)
      const x = typeof params['x'] === 'number' ? params['x'] : item.node.x
      const y = typeof params['y'] === 'number' ? params['y'] : item.node.y
      updateNodes(store, 'Agent move', new Map([[id, { x, y }]]))
      return summarise(node(id))
    },
    delete_nodes: (params) => {
      const targets = ids(params)
      targets.forEach((id) => node(id))
      removeNodes(store, new Set(targets))
      return { deleted: targets }
    },
    set_text: (params) => {
      const id = requireString(params, 'id')
      const item = node(id)
      if (item.node.type !== 'text') {
        throw new Error(`Node "${id}" is a ${item.node.type}, not text.`)
      }
      setNodeProps(store, 'Agent set text', [id], { content: requireString(params, 'content') })
      return summarise(node(id))
    },
    set_theme: (params) => {
      const selectionValue = params['theme']
      if (typeof selectionValue !== 'object' || selectionValue === null) {
        throw new Error('Missing required object parameter "theme".')
      }
      setActiveTheme(selectionValue as Record<string, string>)
      return { active: activeTheme() }
    },
    detach_instance: (params) => {
      const id = requireString(params, 'id')
      const item = node(id)
      const raw = itemById(store.getState(), id)
      if (!raw || raw.node.type !== 'ref') {
        throw new Error(`Node "${id}" is not a component instance.`)
      }
      detachInstance(store, id, item.node)
      return { detached: id }
    },
    create_node: (params) => {
      const parentId = typeof params['parentId'] === 'string' ? params['parentId'] : null
      const spec = params['node']
      if (typeof spec !== 'object' || spec === null) {
        throw new Error('Missing required object parameter "node".')
      }
      if (parentId !== null) {
        node(parentId)
      }

      const child = validNode(spec)
      if (itemById(store.getState(), child.id)) {
        throw new Error(`A node with id "${child.id}" already exists.`)
      }
      let inserted = false

      store.apply('Agent create', (draft) => {
        inserted = insertInto(draft.children as Node[], parentId, child)
      })

      if (!inserted) {
        throw new Error(`Could not insert into "${parentId}": it has no children.`)
      }

      return summarise(node(child.id))
    },
  }

  function subtreeIds(id: string): string[] {
    const all = items()
    const root = all.find((item) => item.node.id === id)
    if (!root) {
      return []
    }
    const inside = new Set([id])
    const ordered = [id]
    for (const item of all) {
      if (item.parentId !== null && inside.has(item.parentId) && !inside.has(item.node.id)) {
        inside.add(item.node.id)
        ordered.push(item.node.id)
      }
    }
    return ordered
  }

  function touched(method: string, params: Record<string, unknown>, result: unknown): void {
    const id =
      method === 'create_node'
        ? ((params['node'] as { id?: unknown } | undefined)?.id as string | undefined)
        : typeof params['id'] === 'string'
          ? params['id']
          : undefined

    if (!id || !itemById(resolvedDocument(store), id)) {
      return
    }

    markAgentTouch(id, method === 'create_node' ? subtreeIds(id) : [])
    void result
  }

  return async function handle(request: AgentRequest): Promise<unknown> {
    const reader = read[request.method]
    if (reader) {
      return reader(request.params)
    }

    const writer = write[request.method]
    if (!writer) {
      throw new Error(`Unknown method "${request.method}".`)
    }

    const result = await queue.run(() => writer(request.params))
    touched(request.method, request.params, result)
    return result
  }
}
