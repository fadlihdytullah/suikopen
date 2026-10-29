import type { Canvas, CanvasKit, Paragraph, Surface } from 'canvaskit-wasm'
import type { Document } from '../../shared/schema/document'
import { asNumber, toArray, type Node, type TextNodeValue } from '../../shared/schema/node'
import { buildParagraph } from '../text/paragraph'
import { fontGeneration } from '../text/font-manager'
import { layerBlurRadius, paintInnerShadows, paintOuterShadows, paintStroke } from './effects'
import { fillPaints } from './fills'
import { paintOverlay, type OverlayScene } from './overlay'
import { intersects, sceneItems, type Rect } from './scene-index'
import { nodePath } from './shapes'
import type { Viewport } from './viewport'
import { canvasBackground, canvasStripe } from './canvas-theme'

const STRIPE_GAP = 8

type CachedParagraph = { width: number; generation: number; paragraph: Paragraph; used: boolean }

const paragraphs = new Map<Node, CachedParagraph>()

function cachedParagraph(canvasKit: CanvasKit, node: TextNodeValue, width: number): Paragraph | null {
  const entry = paragraphs.get(node)
  if (entry && entry.width === width && entry.generation === fontGeneration()) {
    entry.used = true
    return entry.paragraph
  }
  entry?.paragraph.delete()
  paragraphs.delete(node)
  const paragraph = buildParagraph(canvasKit, node, width)
  if (paragraph) {
    paragraphs.set(node, { width, generation: fontGeneration(), paragraph, used: true })
  }
  return paragraph
}

function sweepParagraphs(): void {
  for (const [node, entry] of paragraphs) {
    if (entry.used) {
      entry.used = false
    } else {
      entry.paragraph.delete()
      paragraphs.delete(node)
    }
  }
}

function bleed(node: Node): number {
  const stroke = node.stroke && node.stroke.enabled !== false ? (node.stroke.width ?? 1) : 0
  let margin = stroke + (node.type === 'text' ? asNumber(node.fontSize, 16) * 2 : 0)
  for (const effect of toArray(node.effect)) {
    if (effect.enabled === false) {
      continue
    }
    margin +=
      effect.type === 'blur'
        ? effect.radius * 3
        : (effect.blur ?? 0) * 2 + Math.max(Math.abs(effect.offset?.x ?? 0), Math.abs(effect.offset?.y ?? 0))
  }
  return margin
}

function visible(rect: Rect, node: Node, view: Rect): boolean {
  const margin = bleed(node)
  return intersects({ x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 }, view)
}


function paintItem(canvasKit: CanvasKit, canvas: Canvas, node: Node, rect: Rect): void {
  if (node.type === 'group') {
    return
  }

  const blur = layerBlurRadius(node.effect)
  const layered = blur > 0

  if (layered) {
    const paint = new canvasKit.Paint()
    const filter = canvasKit.ImageFilter.MakeBlur(blur, blur, canvasKit.TileMode.Decal, null)
    paint.setImageFilter(filter)
    filter.delete()
    canvas.saveLayer(paint)
    paint.delete()
  }

  const path = nodePath(canvasKit, node, rect)

  paintOuterShadows(canvasKit, canvas, path, node.effect)

  if (node.type !== 'text') {
    for (const paint of fillPaints(canvasKit, node.fill, rect)) {
      canvas.drawPath(path, paint)
      paint.delete()
    }
  }

  if (node.type === 'text') {
    const paragraph = cachedParagraph(canvasKit, node, rect.width)
    if (paragraph) {
      canvas.drawParagraph(paragraph, rect.x, rect.y)
    }
  }

  paintInnerShadows(canvasKit, canvas, path, node.effect)
  paintStroke(canvasKit, canvas, path, node.stroke)

  path.delete()

  if (layered) {
    canvas.restore()
  }
}

export type Scene = {
  document: Document
  viewport: Viewport
  dpr: number
  overlay: OverlayScene
  reveal?: (id: string, now: number) => number
}

function paintStripes(canvasKit: CanvasKit, canvas: Canvas, width: number, height: number): void {
  const builder = new canvasKit.PathBuilder()
  for (let offset = -height; offset < width; offset += STRIPE_GAP) {
    builder.moveTo(offset, height)
    builder.lineTo(offset + height, 0)
  }
  const path = builder.detach()
  const paint = new canvasKit.Paint()
  paint.setStyle(canvasKit.PaintStyle.Stroke)
  paint.setStrokeWidth(1)
  paint.setAntiAlias(true)
  paint.setColor(canvasKit.Color4f(...canvasStripe()))
  canvas.drawPath(path, paint)
  paint.delete()
  path.delete()
}

export function paintScene(canvasKit: CanvasKit, surface: Surface, scene: Scene): void {
  const canvas = surface.getCanvas()

  canvas.clear(canvasKit.Color4f(...canvasBackground()))
  canvas.save()
  canvas.scale(scene.dpr, scene.dpr)
  paintStripes(canvasKit, canvas, surface.width() / scene.dpr, surface.height() / scene.dpr)

  canvas.save()
  canvas.translate(scene.viewport.x, scene.viewport.y)
  canvas.scale(scene.viewport.scale, scene.viewport.scale)

  const now = performance.now()
  const { x, y, scale } = scene.viewport
  const view = { x: -x / scale, y: -y / scale, width: surface.width() / scene.dpr / scale, height: surface.height() / scene.dpr / scale }

  for (const item of sceneItems(scene.document)) {
    if (item.node.type === 'group' || !visible(item, item.node, view)) {
      continue
    }
    const alpha = scene.reveal ? scene.reveal(item.node.id, now) : 1
    if (alpha <= 0) {
      continue
    }
    if (alpha < 1) {
      const layer = new canvasKit.Paint()
      layer.setAlphaf(alpha)
      canvas.saveLayer(layer)
      layer.delete()
      paintItem(canvasKit, canvas, item.node, item)
      canvas.restore()
    } else {
      paintItem(canvasKit, canvas, item.node, item)
    }
  }

  canvas.restore()
  sweepParagraphs()

  paintOverlay(canvasKit, canvas, scene.viewport, scene.overlay)

  canvas.restore()
  surface.flush()
}

export const SNAPSHOT_MAX_SIDE = 4096
export const SNAPSHOT_MAX_PIXELS = 8_000_000

export function snapshotScale(width: number, height: number, wanted = 2): number {
  return Math.min(wanted, SNAPSHOT_MAX_SIDE / Math.max(width, height), Math.sqrt(SNAPSHOT_MAX_PIXELS / (width * height)))
}

export function renderNodePng(canvasKit: CanvasKit, document: Document, id: string, wanted = 2): string | null {
  const items = sceneItems(document)
  const root = items.find((item) => item.node.id === id)
  if (!root || root.width <= 0 || root.height <= 0) {
    return null
  }

  const scale = snapshotScale(root.width, root.height, wanted)
  const surface = canvasKit.MakeSurface(Math.max(1, Math.ceil(root.width * scale)), Math.max(1, Math.ceil(root.height * scale)))
  if (!surface) {
    return null
  }

  const canvas = surface.getCanvas()
  canvas.clear(canvasKit.Color4f(...canvasBackground()))
  canvas.scale(scale, scale)
  canvas.translate(-root.x, -root.y)

  const inside = new Set([id])
  for (const item of items) {
    if (item === root || (item.parentId !== null && inside.has(item.parentId))) {
      inside.add(item.node.id)
      paintItem(canvasKit, canvas, item.node, item)
    }
  }

  surface.flush()
  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes()
  image.delete()
  surface.dispose()

  if (!bytes) {
    return null
  }

  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export function documentBounds(document: Document): Rect {
  const items = sceneItems(document).filter((item) => item.parentId === null)

  if (items.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const item of items) {
    left = Math.min(left, item.x)
    top = Math.min(top, item.y)
    right = Math.max(right, item.x + item.width)
    bottom = Math.max(bottom, item.y + item.height)
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}
