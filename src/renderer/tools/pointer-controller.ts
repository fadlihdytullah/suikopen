import type { DocumentStore } from '../store/document-store'
import type { SelectionStore } from '../store/selection'
import { insertNode, newId, removeNodes, updateNodes, type NodePatch } from '../store/mutations'
import { hitTest, itemsWithin } from '../canvas/hit-test'
import { contains, nodeById, sceneItems, unionBounds, type Rect, type SceneItem } from '../canvas/scene-index'
import { requestZoom } from '../canvas/viewport-ref'
import { canvasIsDark } from '../canvas/canvas-theme'
import type { Node } from '../../shared/schema/node'
import { getToolState, setTool, startTextEdit, subscribeTool, TOOL_KEYS, type Tool } from './tool-state'
import { resolvedDocument } from '../document/current'
import { panBy, toDocument, zoomAt, type Point, type Viewport } from '../canvas/viewport'
import { handleAt, resizeBounds, scaleRectInto, type HandleId } from './transform'
import { snapRect, type Guide } from './snapping'

const SNAP_THRESHOLD_SCREEN = 6
const ZOOM_SENSITIVITY = 0.0025
const NUDGE = 1
const NUDGE_LARGE = 10
const DEFAULT_SIZE = 100
const CLICK_SLOP = 3
const SHAPE_FILL = '#d9d9d9'

type CreateTool = Exclude<Tool, 'move' | 'hand'>

export type Overlay = { marquee: Rect | null; guides: Guide[] }

type Start = { relative: Rect; absolute: Rect }
type Starts = Map<string, Start>

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan' }
  | { kind: 'marquee'; origin: Point; additive: boolean }
  | { kind: 'move'; origin: Point; starts: Starts; bounds: Rect }
  | { kind: 'resize'; handle: HandleId; origin: Point; starts: Starts; bounds: Rect }
  | { kind: 'create'; tool: CreateTool; id: string; origin: Point; parent: Point; moved: boolean }

export type ControllerDeps = {
  store: DocumentStore
  selection: SelectionStore
  canvas: HTMLCanvasElement
  getViewport: () => Viewport
  setViewport: (viewport: Viewport) => void
  setOverlay: (overlay: Overlay) => void
  requestPaint: () => void
}

export function createPointerController({
  store,
  selection,
  canvas,
  getViewport,
  setViewport,
  setOverlay,
  requestPaint,
}: ControllerDeps) {
  let gesture: Gesture = { kind: 'none' }
  let spaceDown = false
  let overlay: Overlay = { marquee: null, guides: [] }

  function publishOverlay(next: Overlay): void {
    overlay = next
    setOverlay(next)
    requestPaint()
  }

  function items(): SceneItem[] {
    return sceneItems(resolvedDocument(store))
  }

  function selectedItems(): SceneItem[] {
    const ids = selection.getState()
    return items().filter((item) => ids.has(item.node.id))
  }

  function selectionBounds(): Rect | null {
    return unionBounds(selectedItems())
  }

  function pointIn(event: { clientX: number; clientY: number }): Point {
    const rect = canvas.getBoundingClientRect()
    return toDocument(getViewport(), { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  function snapCandidates(exclude: Set<string>): Rect[] {
    return items()
      .filter((item) => !exclude.has(item.node.id))
      .map(({ x, y, width, height }) => ({ x, y, width, height }))
  }

  function startRects(): Starts {
    const starts: Starts = new Map()
    for (const item of selectedItems()) {
      starts.set(item.node.id, {
        relative: { x: item.node.x, y: item.node.y, width: item.width, height: item.height },
        absolute: { x: item.x, y: item.y, width: item.width, height: item.height },
      })
    }
    return starts
  }

  function idleCursor(): string {
    const { tool } = getToolState()
    if (spaceDown || tool === 'hand') return 'grab'
    return tool === 'move' ? 'default' : 'crosshair'
  }

  function containerAt(point: Point): SceneItem | undefined {
    const raw = store.getState()
    return items()
      .filter((item) => item.node.type === 'frame' && !item.locked && contains(item, point) && nodeById(raw, item.node.id))
      .sort((a, b) => b.depth - a.depth)[0]
  }

  function startCreate(tool: CreateTool, point: Point): void {
    const container = containerAt(point)
    const parent = container ? { x: container.x, y: container.y } : { x: 0, y: 0 }
    const id = newId()
    const base = { id, x: Math.round(point.x - parent.x), y: Math.round(point.y - parent.y), width: 0, height: 0 }
    const node: Node =
      tool === 'text'
        ? { ...base, type: 'text', content: '', width: 'fit_content', height: 'fit_content', fontSize: 16, fill: container || !canvasIsDark() ? '#000000' : '#ffffff' }
        : tool === 'frame'
          ? { ...base, type: 'frame', fill: '#ffffff', children: [] }
          : { ...base, type: tool, fill: SHAPE_FILL }
    store.beginGesture(`Create ${tool}`)
    if (!insertNode(store, `Create ${tool}`, container?.node.id ?? null, node)) {
      store.endGesture()
      return
    }
    selection.set([id])
    gesture = { kind: 'create', tool, id, origin: point, parent, moved: false }
  }

  function dragRect(origin: Point, point: Point, square: boolean, centered: boolean): Rect {
    let width = Math.abs(point.x - origin.x)
    let height = Math.abs(point.y - origin.y)
    if (square) {
      width = height = Math.max(width, height)
    }
    const signX = point.x < origin.x ? -1 : 1
    const signY = point.y < origin.y ? -1 : 1
    if (centered) {
      return { x: origin.x - width, y: origin.y - height, width: width * 2, height: height * 2 }
    }
    return { x: signX < 0 ? origin.x - width : origin.x, y: signY < 0 ? origin.y - height : origin.y, width, height }
  }

  function finishCreate(current: Extract<Gesture, { kind: 'create' }>): void {
    if (!current.moved && current.tool !== 'text') {
      updateNodes(store, null, new Map([[current.id, { width: DEFAULT_SIZE, height: DEFAULT_SIZE }]]))
    }
    setTool('move')
    if (current.tool === 'text') {
      startTextEdit(current.id, true)
      return
    }
    store.endGesture()
  }

  function capture(pointerId: number, on: boolean): void {
    try {
      if (on) {
        canvas.setPointerCapture(pointerId)
      } else if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId)
      }
    } catch {
      // A pointer that is no longer active cannot be captured; the gesture still works without it.
    }
  }

  function onPointerDown(event: PointerEvent): void {
    capture(event.pointerId, true)

    const { tool } = getToolState()

    if (spaceDown || event.button === 1 || tool === 'hand') {
      gesture = { kind: 'pan' }
      canvas.style.cursor = 'grabbing'
      return
    }

    const point = pointIn(event)

    if (tool !== 'move') {
      startCreate(tool, point)
      return
    }
    const bounds = selectionBounds()
    const handle = bounds ? handleAt(bounds, point, getViewport().scale) : null

    if (handle && bounds) {
      store.beginGesture('Resize')
      gesture = { kind: 'resize', handle, origin: point, starts: startRects(), bounds }
      return
    }

    const hit = hitTest(items(), point)

    if (!hit) {
      if (!event.shiftKey) {
        selection.clear()
      }
      gesture = { kind: 'marquee', origin: point, additive: event.shiftKey }
      publishOverlay({ marquee: { x: point.x, y: point.y, width: 0, height: 0 }, guides: [] })
      return
    }

    if (event.shiftKey) {
      selection.toggle(hit.node.id)
    } else if (!selection.getState().has(hit.node.id)) {
      selection.set([hit.node.id])
    }

    const moveBounds = selectionBounds()
    if (moveBounds) {
      store.beginGesture('Move')
      gesture = { kind: 'move', origin: point, starts: startRects(), bounds: moveBounds }
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (gesture.kind === 'none') {
      return
    }

    if (gesture.kind === 'pan') {
      setViewport(panBy(getViewport(), event.movementX, event.movementY))
      requestPaint()
      return
    }

    const point = pointIn(event)

    if (gesture.kind === 'create') {
      const screenDistance = Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y) * getViewport().scale
      if (!gesture.moved && screenDistance < CLICK_SLOP) {
        return
      }
      gesture.moved = true
      const rect = dragRect(gesture.origin, point, event.shiftKey, event.altKey)
      const patch: NodePatch = { x: Math.round(rect.x - gesture.parent.x), y: Math.round(rect.y - gesture.parent.y), width: Math.round(rect.width) }
      if (gesture.tool !== 'text') {
        patch.height = Math.round(rect.height)
      }
      updateNodes(store, null, new Map([[gesture.id, patch]]))
      return
    }

    if (gesture.kind === 'marquee') {
      const marquee: Rect = {
        x: Math.min(gesture.origin.x, point.x),
        y: Math.min(gesture.origin.y, point.y),
        width: Math.abs(point.x - gesture.origin.x),
        height: Math.abs(point.y - gesture.origin.y),
      }
      const inside = itemsWithin(items(), marquee).map((item) => item.node.id)
      selection.set(gesture.additive ? [...selection.getState(), ...inside] : inside)
      publishOverlay({ marquee, guides: [] })
      return
    }

    const exclude = new Set(gesture.starts.keys())
    const threshold = SNAP_THRESHOLD_SCREEN / getViewport().scale

    if (gesture.kind === 'move') {
      const raw = {
        x: gesture.bounds.x + (point.x - gesture.origin.x),
        y: gesture.bounds.y + (point.y - gesture.origin.y),
        width: gesture.bounds.width,
        height: gesture.bounds.height,
      }
      const snap = snapRect(raw, snapCandidates(exclude), threshold)
      const dx = raw.x + snap.dx - gesture.bounds.x
      const dy = raw.y + snap.dy - gesture.bounds.y

      const patches = new Map<string, NodePatch>()
      for (const [id, start] of gesture.starts) {
        patches.set(id, { x: start.relative.x + dx, y: start.relative.y + dy })
      }
      updateNodes(store, null, patches)
      publishOverlay({ marquee: null, guides: snap.guides })
      return
    }

    const resized = resizeBounds(
      gesture.bounds,
      gesture.handle,
      point.x - gesture.origin.x,
      point.y - gesture.origin.y,
      event.shiftKey
    )
    const snap = snapRect(resized, snapCandidates(exclude), threshold)
    const target: Rect = { ...resized, x: resized.x + snap.dx, y: resized.y + snap.dy }

    const patches = new Map<string, NodePatch>()
    for (const [id, start] of gesture.starts) {
      const next = scaleRectInto(start.absolute, gesture.bounds, target)
      patches.set(id, {
        x: start.relative.x + (next.x - start.absolute.x),
        y: start.relative.y + (next.y - start.absolute.y),
        width: next.width,
        height: next.height,
      })
    }
    updateNodes(store, null, patches)
    publishOverlay({ marquee: null, guides: snap.guides })
  }

  function onPointerUp(event: PointerEvent): void {
    if (gesture.kind === 'move' || gesture.kind === 'resize') {
      store.endGesture()
    }
    if (gesture.kind === 'create') {
      finishCreate(gesture)
    }
    capture(event.pointerId, false)
    gesture = { kind: 'none' }
    canvas.style.cursor = idleCursor()
    publishOverlay({ marquee: null, guides: [] })
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }

    if (event.ctrlKey || event.metaKey) {
      setViewport(zoomAt(getViewport(), screen, Math.exp(-event.deltaY * ZOOM_SENSITIVITY)))
    } else {
      setViewport(panBy(getViewport(), -event.deltaX, -event.deltaY))
    }

    requestPaint()
  }

  function typing(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null
    return !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  }

  function onDoubleClick(event: MouseEvent): void {
    if (getToolState().tool !== 'move') {
      return
    }
    const hit = hitTest(items(), pointIn(event))
    if (hit?.node.type === 'text' && nodeById(store.getState(), hit.node.id)) {
      selection.set([hit.node.id])
      startTextEdit(hit.node.id)
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (typing(event) || getToolState().editingText) {
      return
    }

    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    const tool = plain && !event.shiftKey ? TOOL_KEYS[event.key.toLowerCase()] : undefined
    if (tool) {
      event.preventDefault()
      setTool(tool)
      return
    }

    if (plain && event.shiftKey && (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit0')) {
      event.preventDefault()
      requestZoom(event.code === 'Digit1' ? 'fit' : event.code === 'Digit2' ? 'selection' : 'actual')
      return
    }

    if (event.key === 'Enter' && plain && !event.shiftKey) {
      const [only, ...rest] = selectedItems()
      if (only && rest.length === 0 && only.node.type === 'text' && nodeById(store.getState(), only.node.id)) {
        event.preventDefault()
        startTextEdit(only.node.id)
        return
      }
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && selection.getState().size > 0) {
      event.preventDefault()
      removeNodes(store, selection.getState())
      selection.clear()
      return
    }

    if (event.code === 'Space' && !spaceDown) {
      spaceDown = true
      canvas.style.cursor = 'grab'
      return
    }

    const step = event.shiftKey ? NUDGE_LARGE : NUDGE
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const move = delta[event.key]

    if (move && selection.getState().size > 0) {
      event.preventDefault()
      const patches = new Map<string, NodePatch>()
      for (const item of selectedItems()) {
        patches.set(item.node.id, { x: item.node.x + move.x, y: item.node.y + move.y })
      }
      updateNodes(store, 'Nudge', patches)
      return
    }

    if (event.key === 'Escape') {
      if (getToolState().tool !== 'move') {
        setTool('move')
      } else {
        selection.clear()
      }
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      spaceDown = false
      canvas.style.cursor = idleCursor()
    }
  }

  function onBlur(): void {
    if (gesture.kind === 'move' || gesture.kind === 'resize') {
      store.endGesture()
    }
    if (gesture.kind === 'create') {
      finishCreate(gesture)
    }
    gesture = { kind: 'none' }
    spaceDown = false
    publishOverlay({ marquee: null, guides: [] })
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('dblclick', onDoubleClick)
  const offTool = subscribeTool(() => {
    if (gesture.kind === 'none') canvas.style.cursor = idleCursor()
  })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  return {
    getOverlay: () => overlay,
    dispose: () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDoubleClick)
      offTool()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    },
  }
}

export type PointerController = ReturnType<typeof createPointerController>
