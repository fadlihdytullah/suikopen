import type { AgentRequest, NodeSummary } from '../../shared/mcp/contract'
import { hasChildren, NodeSchema, toArray, type Node } from '../../shared/schema/node'
import { allowedImageUrl, IMAGE_HOSTS } from '../../shared/image-hosts'
import { VariableSchema, type Variable } from '../../shared/schema/document'
import { MEMORY_KINDS, removeNotes, upsertNote, type MemoryKind } from '../../shared/schema/memory'
import { itemById, nodeById, parentChain, sceneItems, type Rect, type SceneItem } from '../canvas/scene-index'
import { resolved } from '../document/resolved'
import type { ThemeSelection } from '../../shared/schema/document'
import { detachInstance } from '../store/mutations'
import type { Presence } from '../agent/presence'
import { currentViewport } from '../canvas/viewport-ref'
import { loadCanvasKit } from '../canvas/canvaskit'
import { renderNodePng } from '../canvas/paint'
import { toScreen } from '../canvas/viewport'
import type { DocumentStore } from '../store/document-store'
import type { MutationQueue } from '../store/mutation-queue'
import { removeNodes, setNodeProps, updateNodes } from '../store/mutations'
import { findProblems, type Problem } from './problems'
import { exportHtml, variablesCss, type ExportFormat } from './html-export'
import { resolveDocument } from '../document/resolve'
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

function refuseRemoteImages(node: Node): void {
  for (const fill of toArray(node.fill)) {
    if (typeof fill === 'object' && fill.type === 'image' && /^https?:/i.test(fill.url) && !allowedImageUrl(fill.url)) {
      throw new Error(`Image "${fill.url}" was refused: images load only over https from ${IMAGE_HOSTS.join(', ')}. Use find_icons for icons and logos.`)
    }
  }
  if (hasChildren(node)) {
    node.children.forEach(refuseRemoteImages)
  }
}

function validNode(candidate: unknown): Node {
  const result = NodeSchema.safeParse(candidate)
  if (result.success) {
    refuseRemoteImages(result.data)
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

export const MAX_BATCH_OPS = 200
const BATCHABLE = ['create_node', 'update_node', 'move_node', 'set_text', 'delete_nodes']

function findNode(nodes: Node[], id: string): Node | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    const found = hasChildren(node) ? findNode(node.children, id) : null
    if (found) {
      return found
    }
  }
  return null
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
  presence: Presence
  documentPath: () => string | null
  theme?: { get: () => ThemeSelection; set: (next: ThemeSelection) => void }
  visible?: () => boolean
}

const LOCAL_THEME = () => {
  let selection: ThemeSelection = {}
  return { get: () => selection, set: (next: ThemeSelection) => (selection = next) }
}

export function createAgentHandlers({ store, selection, queue, presence, documentPath, theme = LOCAL_THEME(), visible = () => true }: HandlerContext) {
  function resolvedDoc() {
    return resolved(store.getState(), theme.get()).document
  }

  function items(): SceneItem[] {
    return sceneItems(resolvedDoc())
  }

  function node(id: string): SceneItem {
    const item = itemById(resolvedDoc(), id)
    if (!item) {
      throw new Error(`No node with id "${id}".`)
    }
    return item
  }

  let batching = false

  function withProblems(id: string) {
    const item = node(id)
    if (batching) {
      return summarise(item)
    }
    const problems = findProblems(items(), item.parentId ?? id)
    return problems.length ? { ...summarise(item), problems } : summarise(item)
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
    get_theme: () => ({ axes: store.getState().themes ?? {}, active: theme.get() }),
    render_node: async (params) => {
      const id = requireString(params, 'id')
      node(id)
      const canvasKit = await loadCanvasKit()
      const png = renderNodePng(canvasKit, resolvedDoc(), id)
      if (!png) {
        throw new Error(`Could not render "${id}".`)
      }
      return { png }
    },
    get_memory: () => ({ notes: store.getState().memory ?? [] }),
    get_variables: () => {
      const { variables = {}, themes = {} } = store.getState()
      return { variables, themes, css: variablesCss(variables) }
    },
    export_code: (params) => {
      const id = requireString(params, 'id')
      node(id)
      const format: ExportFormat = params['format'] === 'html-css' ? 'html-css' : 'html-tailwind'
      const state = store.getState()
      const tokens = resolveDocument({ ...state, variables: undefined }).document
      const target = findNode(tokens.children, id)
      if (!target) {
        throw new Error(`Could not export "${id}".`)
      }
      const rects = new Map<string, Rect>(items().map((item) => [item.node.id, item]))
      return exportHtml(target, rects, format, state.variables)
    },
    get_problems: (params) => findProblems(items(), node(requireString(params, 'id')).node.id),
    get_screen_rect: (params) => {
      const item = node(requireString(params, 'id'))
      if (!visible()) {
        throw new Error('This tab is not on screen. Use screenshot with an id to render a node instead.')
      }
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
      const raw = nodeById(store.getState(), id)
      if (!raw) {
        throw new Error(`Node "${id}" is inside a component instance; update the master or detach the instance.`)
      }
      validNode({ ...raw, ...(props as Record<string, unknown>), id })
      setNodeProps(store, 'Agent update', [id], props as Record<string, unknown>)
      return withProblems(id)
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
      theme.set(selectionValue as Record<string, string>)
      return { active: theme.get() }
    },
    detach_instance: (params) => {
      const id = requireString(params, 'id')
      const item = node(id)
      const raw = nodeById(store.getState(), id)
      if (!raw || raw.type !== 'ref') {
        throw new Error(`Node "${id}" is not a component instance.`)
      }
      detachInstance(store, id, item.node)
      return { detached: id }
    },
    remember: (params) => {
      const kind = params['kind']
      if (kind !== undefined && !MEMORY_KINDS.includes(kind as MemoryKind)) {
        throw new Error(`Invalid kind "${String(kind)}": use ${MEMORY_KINDS.join(', ')}.`)
      }
      const key = typeof params['key'] === 'string' && params['key'] ? params['key'] : undefined
      let saved = null as ReturnType<typeof upsertNote>['note'] | null
      store.setMemory((notes) => {
        const result = upsertNote(notes, { key, kind: kind as MemoryKind | undefined, text: requireString(params, 'text'), by: 'agent' }, crypto.randomUUID().slice(0, 8), Date.now())
        saved = result.note
        return result.notes
      })
      return { remembered: saved, count: store.getState().memory?.length ?? 0 }
    },
    forget: (params) => {
      const refs = ids(params)
      const before = store.getState().memory?.length ?? 0
      store.setMemory((notes) => removeNotes(notes, refs))
      return { forgotten: before - (store.getState().memory?.length ?? 0) }
    },
    set_variables: (params) => {
      const input = params['variables']
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('Missing required object parameter "variables".')
      }
      const parsed: Record<string, Variable> = {}
      for (const [name, value] of Object.entries(input)) {
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
          throw new Error(`Invalid variable name "${name}": use letters, digits, "-" and "_".`)
        }
        const result = VariableSchema.safeParse(value)
        if (!result.success) {
          throw new Error(`Invalid variable "${name}": ${result.error.issues[0]?.message ?? 'does not match the schema'}.`)
        }
        parsed[name] = result.data
      }
      const axes: Record<string, Set<string>> = {}
      for (const variable of Object.values(parsed)) {
        for (const entry of Array.isArray(variable.value) ? variable.value : []) {
          for (const [axis, option] of Object.entries(entry.theme ?? {})) {
            ;(axes[axis] ??= new Set()).add(option)
          }
        }
      }
      store.apply('Agent set variables', (draft) => {
        draft.variables = params['replace'] === true ? parsed : { ...(draft.variables ?? {}), ...parsed }
        for (const [axis, options] of Object.entries(axes)) {
          const themes = (draft.themes ??= {})
          themes[axis] = [...new Set([...(themes[axis] ?? []), ...options])]
        }
      })
      return { variables: Object.keys(store.getState().variables ?? {}), themes: store.getState().themes ?? {} }
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
      if (nodeById(store.getState(), child.id)) {
        throw new Error(`A node with id "${child.id}" already exists.`)
      }
      let inserted = false

      store.apply('Agent create', (draft) => {
        inserted = insertInto(draft.children as Node[], parentId, child)
      })

      if (!inserted) {
        throw new Error(`Could not insert into "${parentId}": it has no children.`)
      }

      return withProblems(child.id)
    },
  }

  function touchedId(method: string, params: Record<string, unknown>): string | undefined {
    return method === 'create_node'
      ? ((params['node'] as { id?: unknown } | undefined)?.id as string | undefined)
      : typeof params['id'] === 'string'
        ? params['id']
        : undefined
  }

  function runBatch(params: Record<string, unknown>) {
    const ops = params['ops']
    if (!Array.isArray(ops) || ops.length === 0) {
      throw new Error('Missing required array parameter "ops".')
    }
    if (ops.length > MAX_BATCH_OPS) {
      throw new Error(`A batch holds at most ${MAX_BATCH_OPS} operations; split it.`)
    }

    const start = store.getState()
    const results: unknown[] = []
    store.beginGesture('Agent batch')
    batching = true
    try {
      ops.forEach((op: unknown, index) => {
        const { tool: method, ...rest } = (typeof op === 'object' && op !== null ? op : {}) as Record<string, unknown>
        const writer = typeof method === 'string' && BATCHABLE.includes(method) ? write[method] : undefined
        if (!writer) {
          throw new Error(`Operation ${index + 1}: "tool" must be one of ${BATCHABLE.join(', ')}.`)
        }
        try {
          results.push(writer(rest))
        } catch (error) {
          throw new Error(`Operation ${index + 1} (${method}) failed: ${(error as Error).message} Nothing in this batch was applied.`)
        }
      })
    } catch (error) {
      batching = false
      store.endGesture()
      if (store.getState() !== start) {
        store.undo()
      }
      throw error
    }
    batching = false
    store.endGesture()

    const all = items()
    const roots = new Set<string>()
    ops.forEach((op: Record<string, unknown>) => {
      const id = touchedId(String(op['tool']), op)
      if (id && itemById(resolvedDoc(), id)) {
        roots.add(parentChain(all, id).at(-1) ?? id)
        touched(String(op['tool']), op)
      }
    })
    const problems: Problem[] = [...roots].flatMap((root) => findProblems(all, root))
    return problems.length ? { results, problems } : { results }
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

  function touched(method: string, params: Record<string, unknown>): void {
    const id = touchedId(method, params)

    if (!id || !itemById(resolvedDoc(), id)) {
      return
    }

    presence.markTouch(id, method === 'create_node' ? subtreeIds(id) : [])
  }

  return async function handle(request: AgentRequest): Promise<unknown> {
    const reader = read[request.method]
    if (reader) {
      return reader(request.params)
    }

    if (request.method === 'batch') {
      return queue.run(() => runBatch(request.params))
    }

    const writer = write[request.method]
    if (!writer) {
      throw new Error(`Unknown method "${request.method}".`)
    }

    const result = await queue.run(() => writer(request.params))
    touched(request.method, request.params)
    return result
  }
}
