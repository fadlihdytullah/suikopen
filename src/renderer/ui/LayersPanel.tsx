import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Document } from '../../shared/schema/document'
import { hasChildren, type Node } from '../../shared/schema/node'
import { moveNodes, setNodeProps, type DropTarget } from '../store/mutations'
import { useDocument, useDocumentStore, useSelection, useSelectionStore } from '../store/use-store'

const ROW_HEIGHT = 28
const OVERSCAN = 8

type Row = { node: Node; depth: number; parentId: string | null; expandable: boolean; dimmed: boolean }

const TYPE_LABELS: Record<Node['type'], string> = {
  frame: 'Frame',
  group: 'Group',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  ref: 'Instance',
}

export function layerName(node: Node, masterOf?: (id: string) => Node | undefined): string {
  if (node.name) {
    return node.name
  }
  if (node.type === 'ref') {
    const master = masterOf?.(node.masterId)
    return master ? layerName(master) : TYPE_LABELS.ref
  }
  if (node.type === 'text' && node.content.trim()) {
    return node.content.trim().slice(0, 40)
  }
  return TYPE_LABELS[node.type]
}

function parentMap(document: Document): { parents: Map<string, string | null>; byId: Map<string, Node> } {
  const parents = new Map<string, string | null>()
  const byId = new Map<string, Node>()
  const visit = (nodes: Node[], parentId: string | null) => {
    for (const node of nodes) {
      parents.set(node.id, parentId)
      byId.set(node.id, node)
      if (hasChildren(node)) {
        visit(node.children, node.id)
      }
    }
  }
  visit(document.children, null)
  return { parents, byId }
}

function flatten(document: Document, expanded: ReadonlySet<string>, query: string, masterOf: (id: string) => Node | undefined): Row[] {
  const rows: Row[] = []
  const needle = query.trim().toLowerCase()
  const matches = (node: Node): boolean =>
    layerName(node, masterOf).toLowerCase().includes(needle) || (hasChildren(node) && node.children.some(matches))

  const visit = (nodes: Node[], depth: number, parentId: string | null, dimmed: boolean) => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]!
      if (needle && !matches(node)) {
        continue
      }
      const expandable = hasChildren(node) && node.children.length > 0
      const hidden = dimmed || node.visible === false
      rows.push({ node, depth, parentId, expandable, dimmed: hidden })
      if (expandable && (needle || expanded.has(node.id))) {
        visit((node as Node & { children: Node[] }).children, depth + 1, node.id, hidden)
      }
    }
  }

  visit(document.children, 0, null, false)
  return rows
}

export function TypeIcon({ node }: { node: Node }): React.ReactElement {
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true, className: 'layer-icon' } as const
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' } as const

  if (node.type === 'frame' && node.layout === 'vertical') {
    return (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" {...stroke} />
        <path d="M5 5.5h4M5 8.5h4" {...stroke} />
      </svg>
    )
  }
  if (node.type === 'frame' && node.layout === 'horizontal') {
    return (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" {...stroke} />
        <path d="M5.5 5v4M8.5 5v4" {...stroke} />
      </svg>
    )
  }
  if (node.type === 'frame') {
    return (
      <svg {...common}>
        <path d="M4.5 2v10M9.5 2v10M2 4.5h10M2 9.5h10" {...stroke} />
      </svg>
    )
  }
  if (node.type === 'group') {
    return (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" {...stroke} strokeDasharray="2 1.6" />
      </svg>
    )
  }
  if (node.type === 'ellipse') {
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="4.5" {...stroke} />
      </svg>
    )
  }
  if (node.type === 'text') {
    return (
      <svg {...common}>
        <path d="M3.5 3.5h7M7 3.5v7.5" {...stroke} />
      </svg>
    )
  }
  if (node.type === 'ref') {
    return (
      <svg {...common} className="layer-icon layer-icon-component">
        <path d="M7 2 12 7 7 12 2 7Z" {...stroke} />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="2.5" y="2.5" width="9" height="9" rx="1" {...stroke} />
    </svg>
  )
}

function EyeIcon({ off }: { off: boolean }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M1.5 7S3.5 3 7 3s5.5 4 5.5 4-2 4-5.5 4S1.5 7 1.5 7Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {off ? <path d="M2.5 11.5 11.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /> : <circle cx="7" cy="7" r="1.6" fill="currentColor" />}
    </svg>
  )
}

function LockIcon({ on }: { on: boolean }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="3" y="6.5" width="8" height="5.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d={on ? 'M4.8 6.5V4.8a2.2 2.2 0 0 1 4.4 0v1.7' : 'M4.8 6.5V4.8a2.2 2.2 0 0 1 4.3-.6'} fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function LayersPanel(): React.ReactElement {
  const store = useDocumentStore()
  const selectionStore = useSelectionStore()
  const document = useDocument()
  const selection = useSelection()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)
  const listRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<string | null>(null)
  const dragRef = useRef<{ id: string; ids: string[]; startY: number; active: boolean } | null>(null)
  const [drop, setDrop] = useState<(DropTarget & { index: number; depth: number }) | null>(null)

  const { parents, byId } = useMemo(() => parentMap(document), [document])
  const masterOf = (id: string) => byId.get(id)
  const rows = useMemo(() => flatten(document, expanded, query, masterOf), [document, expanded, query])
  const indexById = useMemo(() => new Map(rows.map((row, index) => [row.node.id, index])), [rows])

  useEffect(() => {
    const ids = [...selection].map((id) => id.split('/')[0]!).filter((id) => parents.has(id))
    if (ids.length === 0) {
      return
    }
    const ancestors = new Set<string>()
    for (const id of ids) {
      let current = parents.get(id) ?? null
      while (current) {
        ancestors.add(current)
        current = parents.get(current) ?? null
      }
    }
    if ([...ancestors].some((id) => !expanded.has(id))) {
      setExpanded((current) => new Set([...current, ...ancestors]))
    }
    setFocusId(ids[ids.length - 1]!)
  }, [selection, parents])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const observer = new ResizeObserver(() => setViewport(list.clientHeight))
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const list = listRef.current
    const index = focusId ? indexById.get(focusId) : undefined
    if (!list || index === undefined) {
      return
    }
    const top = index * ROW_HEIGHT
    if (top < list.scrollTop) {
      list.scrollTop = top
    } else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight
    }
  }, [focusId, indexById])

  function toggleExpanded(id: string, open?: boolean): void {
    setExpanded((current) => {
      const next = new Set(current)
      if (open ?? !next.has(id)) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  function select(id: string, event?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): void {
    setFocusId(id)
    if (event?.metaKey || event?.ctrlKey) {
      selectionStore.toggle(id)
      anchorRef.current = id
      return
    }
    if (event?.shiftKey && anchorRef.current && indexById.has(anchorRef.current)) {
      const from = indexById.get(anchorRef.current)!
      const to = indexById.get(id)!
      const [start, end] = from < to ? [from, to] : [to, from]
      selectionStore.set(rows.slice(start, end + 1).map((row) => row.node.id))
      return
    }
    anchorRef.current = id
    selectionStore.set([id])
  }

  function dropTargetAt(clientY: number): (DropTarget & { index: number; depth: number }) | null {
    const list = listRef.current
    if (!list) {
      return null
    }
    const y = clientY - list.getBoundingClientRect().top + list.scrollTop
    const index = Math.min(rows.length - 1, Math.max(0, Math.floor(y / ROW_HEIGHT)))
    const row = rows[index]
    if (!row || dragRef.current?.ids.includes(row.node.id)) {
      return null
    }
    const fraction = (y - index * ROW_HEIGHT) / ROW_HEIGHT
    const container = hasChildren(row.node)
    if (container && fraction > 0.25 && fraction < 0.75) {
      return { refId: row.node.id, position: 'inside', index, depth: row.depth }
    }
    return { refId: row.node.id, position: fraction < 0.5 ? 'above' : 'below', index, depth: row.depth }
  }

  function commitRename(id: string, value: string): void {
    setRenaming(null)
    const node = rows.find((row) => row.node.id === id)?.node
    const name = value.trim()
    if (node && name && name !== layerName(node, masterOf)) {
      setNodeProps(store, 'Rename layer', [id], { name })
    }
    listRef.current?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (renaming) {
      return
    }
    const index = focusId ? (indexById.get(focusId) ?? -1) : -1
    const row = rows[index]
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'F2']
    if (!keys.includes(event.key)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      const next =
        event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
      const target = rows[next]
      if (target) {
        select(target.node.id, { shiftKey: event.shiftKey, metaKey: false, ctrlKey: false })
      }
      return
    }
    if (!row) {
      return
    }
    if (event.key === 'ArrowRight') {
      if (row.expandable && !expanded.has(row.node.id)) {
        toggleExpanded(row.node.id, true)
      } else if (row.expandable && rows[index + 1]) {
        select(rows[index + 1]!.node.id)
      }
    } else if (event.key === 'ArrowLeft') {
      if (row.expandable && expanded.has(row.node.id) && !query) {
        toggleExpanded(row.node.id, false)
      } else if (row.parentId) {
        select(row.parentId)
      }
    } else {
      setRenaming(row.node.id)
    }
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const activeId = focusId && indexById.has(focusId) ? `layer-${focusId}` : undefined

  return (
    <div className="layers">
      <div className="layers-search">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="5.2" cy="5.2" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="m8 8 2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          placeholder="Search layers"
          aria-label="Search layers"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              listRef.current?.focus()
              if (rows[0]) select(rows[0].node.id)
            }
          }}
        />
      </div>

      <div
        ref={listRef}
        className="layers-list"
        role="tree"
        aria-label="Layers"
        aria-multiselectable="true"
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag) {
            return
          }
          if (!drag.active && Math.abs(event.clientY - drag.startY) > 4) {
            drag.active = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          if (drag.active) {
            setDrop(dropTargetAt(event.clientY))
          }
        }}
        onPointerUp={() => {
          const drag = dragRef.current
          dragRef.current = null
          if (drag && !drag.active && drag.ids.length > 1) {
            select(drag.id)
          }
          if (drag?.active && drop) {
            moveNodes(store, drag.ids, drop)
            if (drop.position === 'inside') {
              toggleExpanded(drop.refId, true)
            }
          }
          setDrop(null)
        }}
        onPointerCancel={() => {
          dragRef.current = null
          setDrop(null)
        }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            selectionStore.clear()
          }
        }}
      >
        {rows.length === 0 ? (
          <p className="layers-empty">{query ? `No layers match “${query.trim()}”.` : 'No layers yet. Draw a shape or ask the agent to build a screen.'}</p>
        ) : null}
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }} role="presentation">
          {drop && drop.position !== 'inside' ? (
            <div
              className="layer-drop-line"
              style={{ top: (drop.index + (drop.position === 'below' ? 1 : 0)) * ROW_HEIGHT - 1, left: 26 + drop.depth * 14 }}
            />
          ) : null}
          {rows.slice(first, last).map((row, offset) => {
            const { node } = row
            const index = first + offset
            const selected = selection.has(node.id)
            const parentSelected = !selected && [...selection].some((id) => {
              let current = parents.get(node.id) ?? null
              while (current) {
                if (current === id) return true
                current = parents.get(current) ?? null
              }
              return false
            })
            const open = !!query || expanded.has(node.id)
            const hidden = node.visible === false
            const locked = node.locked === true
            return (
              <div
                key={node.id}
                id={`layer-${node.id}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={selected}
                aria-expanded={row.expandable ? open : undefined}
                className={`layer-row${drop?.position === 'inside' && drop.refId === node.id ? ' drop-inside' : ''}${selected ? ' selected' : ''}${parentSelected ? ' within' : ''}${row.dimmed ? ' dimmed' : ''}${focusId === node.id ? ' focused' : ''}`}
                style={{ top: index * ROW_HEIGHT, paddingLeft: 6 + row.depth * 14 }}
                onPointerDown={(event) => {
                  if (event.button === 0 && !(event.target as HTMLElement).closest('button, input')) {
                    const dragIds = selection.has(node.id) && !event.shiftKey && !event.metaKey ? [...selection] : [node.id]
                    if (!selection.has(node.id) || event.shiftKey || event.metaKey || event.ctrlKey) {
                      select(node.id, event)
                    } else {
                      setFocusId(node.id)
                    }
                    dragRef.current = { id: node.id, ids: dragIds.filter((id) => parents.has(id)), startY: event.clientY, active: false }
                  }
                }}
                onDoubleClick={(event) => {
                  if (!(event.target as HTMLElement).closest('button')) {
                    setRenaming(node.id)
                  }
                }}
              >
                {row.expandable ? (
                  <button className={`layer-chevron${open ? ' open' : ''}`} tabIndex={-1} aria-hidden="true" onClick={() => toggleExpanded(node.id)}>
                    <svg width="8" height="8" viewBox="0 0 8 8">
                      <path d="M2.5 1.5 5.5 4l-3 2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : (
                  <span className="layer-chevron" />
                )}
                <TypeIcon node={node} />
                {renaming === node.id ? (
                  <input
                    className="layer-rename"
                    aria-label="Layer name"
                    defaultValue={layerName(node, masterOf)}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={(event) => commitRename(node.id, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter') {
                        commitRename(node.id, event.currentTarget.value)
                      } else if (event.key === 'Escape') {
                        setRenaming(null)
                        listRef.current?.focus()
                      }
                    }}
                  />
                ) : (
                  <span className={`layer-name${node.type === 'ref' ? ' component' : ''}`}>{layerName(node, masterOf)}</span>
                )}
                <span className="layer-actions">
                  <button
                    className={`layer-action${locked ? ' on' : ''}`}
                    tabIndex={-1}
                    aria-label={locked ? `Unlock ${layerName(node, masterOf)}` : `Lock ${layerName(node, masterOf)}`}
                    title={locked ? 'Unlock' : 'Lock'}
                    onClick={() => setNodeProps(store, locked ? 'Unlock layer' : 'Lock layer', [node.id], { locked: locked ? undefined : true })}
                  >
                    <LockIcon on={locked} />
                  </button>
                  <button
                    className={`layer-action${hidden ? ' on' : ''}`}
                    tabIndex={-1}
                    aria-label={hidden ? `Show ${layerName(node, masterOf)}` : `Hide ${layerName(node, masterOf)}`}
                    title={hidden ? 'Show' : 'Hide'}
                    onClick={() => setNodeProps(store, hidden ? 'Show layer' : 'Hide layer', [node.id], { visible: hidden ? undefined : false })}
                  >
                    <EyeIcon off={hidden} />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
