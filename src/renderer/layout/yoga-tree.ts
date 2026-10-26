import Yoga, { Align, Direction, Edge, FlexDirection, Gutter, Justify, PositionType, type Node as YogaNode } from 'yoga-layout'
import type { Document } from '../../shared/schema/document'
import { asNumber, hasChildren, type LayoutModeValue, type Node } from '../../shared/schema/node'
import { parsePadding, parseSizing, type Sizing } from './sizing'
import { measureText } from './text-measure'
import { MeasureMode } from 'yoga-layout'

export type LayoutRect = { x: number; y: number; width: number; height: number }
export type LayoutMap = Map<string, LayoutRect>

const ROOT_SIZE = 1_000_000

const JUSTIFY = {
  start: Justify.FlexStart,
  center: Justify.Center,
  end: Justify.FlexEnd,
  space_between: Justify.SpaceBetween,
  space_around: Justify.SpaceAround,
} as const

const ALIGN = {
  start: Align.FlexStart,
  center: Align.Center,
  end: Align.FlexEnd,
} as const

function ownLayout(node: Node): LayoutModeValue {
  return node.type === 'frame' ? (node.layout ?? 'none') : 'none'
}

function canHug(node: Node): boolean {
  if (node.type === 'text') {
    return true
  }
  return hasChildren(node) && node.children.length > 0 && ownLayout(node) !== 'none'
}

function applyAxis(
  yogaNode: YogaNode,
  sizing: Sizing,
  horizontal: boolean,
  node: Node,
  parentLayout: LayoutModeValue
): void {
  const setSize = horizontal ? yogaNode.setWidth.bind(yogaNode) : yogaNode.setHeight.bind(yogaNode)
  const setAuto = horizontal ? yogaNode.setWidthAuto.bind(yogaNode) : yogaNode.setHeightAuto.bind(yogaNode)
  const isMainAxis = (parentLayout === 'horizontal') === horizontal

  if (sizing.kind === 'fixed') {
    setSize(sizing.value)
    return
  }

  if (sizing.kind === 'fit_content') {
    if (canHug(node)) {
      setAuto()
    } else {
      setSize(sizing.fallback ?? 0)
    }
    return
  }

  if (parentLayout === 'none') {
    setSize(sizing.fallback ?? 0)
    return
  }

  if (isMainAxis) {
    yogaNode.setFlexGrow(1)
    yogaNode.setFlexShrink(1)
    yogaNode.setFlexBasis(0)
    setAuto()
  } else {
    yogaNode.setAlignSelf(Align.Stretch)
    setAuto()
  }
}

type CacheEntry = { yoga: YogaNode; parentLayout: LayoutModeValue }

const cache = new Map<Node, CacheEntry>()
let used = new Set<Node>()

function markSubtreeUsed(node: Node): void {
  used.add(node)
  if (hasChildren(node)) {
    for (const child of node.children) {
      markSubtreeUsed(child)
    }
  }
}

function detach(yogaNode: YogaNode): void {
  const parent = yogaNode.getParent()
  if (parent) {
    parent.removeChild(yogaNode)
  }
}

function sweep(): void {
  for (const [node, entry] of cache) {
    if (!used.has(node)) {
      detach(entry.yoga)
      entry.yoga.free()
      cache.delete(node)
    }
  }
  used = new Set()
}

function build(node: Node, parentLayout: LayoutModeValue): YogaNode {
  const cached = cache.get(node)
  if (cached && cached.parentLayout === parentLayout) {
    detach(cached.yoga)
    markSubtreeUsed(node)
    return cached.yoga
  }

  const yogaNode = Yoga.Node.create()

  if (parentLayout === 'none') {
    yogaNode.setPositionType(PositionType.Absolute)
    yogaNode.setPosition(Edge.Left, node.x)
    yogaNode.setPosition(Edge.Top, node.y)
  }

  applyAxis(yogaNode, parseSizing(node.width), true, node, parentLayout)
  applyAxis(yogaNode, parseSizing(node.height), false, node, parentLayout)

  const layout = ownLayout(node)
  yogaNode.setFlexDirection(layout === 'horizontal' ? FlexDirection.Row : FlexDirection.Column)

  if (node.type === 'frame') {
    const padding = parsePadding(node.padding)
    yogaNode.setPadding(Edge.Top, padding.top)
    yogaNode.setPadding(Edge.Right, padding.right)
    yogaNode.setPadding(Edge.Bottom, padding.bottom)
    yogaNode.setPadding(Edge.Left, padding.left)

    if (node.gap) {
      yogaNode.setGap(Gutter.All, asNumber(node.gap))
    }
    if (node.justifyContent) {
      yogaNode.setJustifyContent(JUSTIFY[node.justifyContent])
    }
    if (node.alignItems) {
      yogaNode.setAlignItems(ALIGN[node.alignItems])
    }
  }

  if (node.type === 'text') {
    const sizing = parseSizing(node.width)
    const hugs = parseSizing(node.height).kind === 'fit_content' || sizing.kind === 'fit_content'
    if (hugs) {
      yogaNode.setMeasureFunc((width, widthMode) => {
        const available = widthMode === MeasureMode.Undefined ? Number.POSITIVE_INFINITY : width
        return measureText(node, available) ?? { width: 0, height: 0 }
      })
    }
  }

  if (hasChildren(node)) {
    node.children.forEach((child, index) => {
      yogaNode.insertChild(build(child, layout), index)
    })
  }

  cache.set(node, { yoga: yogaNode, parentLayout })
  used.add(node)

  return yogaNode
}

function collect(node: Node, yogaNode: YogaNode, originX: number, originY: number, into: LayoutMap): void {
  const computed = yogaNode.getComputedLayout()
  const x = originX + computed.left
  const y = originY + computed.top

  into.set(node.id, { x, y, width: computed.width, height: computed.height })

  if (hasChildren(node)) {
    node.children.forEach((child, index) => {
      const childYoga = yogaNode.getChild(index)
      if (childYoga) {
        collect(child, childYoga, x, y, into)
      }
    })
  }
}

let root: YogaNode | null = null

export function resetLayoutCache(): void {
  for (const entry of cache.values()) {
    detach(entry.yoga)
    entry.yoga.free()
  }
  cache.clear()
  used = new Set()
  root?.free()
  root = null
}

export function layoutCacheSize(): number {
  return cache.size
}

export function computeLayout(document: Document): LayoutMap {
  if (!root) {
    root = Yoga.Node.create()
    root.setWidth(ROOT_SIZE)
    root.setHeight(ROOT_SIZE)
  }

  while (root.getChildCount() > 0) {
    root.removeChild(root.getChild(0)!)
  }

  document.children.forEach((child, index) => {
    root!.insertChild(build(child, 'none'), index)
  })

  root.calculateLayout(ROOT_SIZE, ROOT_SIZE, Direction.LTR)

  const map: LayoutMap = new Map()
  document.children.forEach((child, index) => {
    const childYoga = root!.getChild(index)
    if (childYoga) {
      collect(child, childYoga, 0, 0, map)
    }
  })

  sweep()

  return map
}
