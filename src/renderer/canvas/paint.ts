import type { Canvas, CanvasKit, Surface } from 'canvaskit-wasm'
import type { Document } from '../../shared/schema/document'
import type { Node } from '../../shared/schema/node'
import { buildParagraph } from '../text/paragraph'
import { layerBlurRadius, paintInnerShadows, paintOuterShadows, paintStroke } from './effects'
import { fillPaints } from './fills'
import { paintOverlay, type OverlayScene } from './overlay'
import { sceneItems, type Rect } from './scene-index'
import { nodePath } from './shapes'
import type { Viewport } from './viewport'
import { revealAlpha } from '../agent/presence'
import { canvasBackground, canvasStripe } from './canvas-theme'

const STRIPE_GAP = 8


function paintItem(canvasKit: CanvasKit, canvas: Canvas, node: Node, rect: Rect): void {
  if (node.type === 'group') {
    return
  }

  const blur = layerBlurRadius(node.effect)
  const layered = blur > 0

  if (layered) {
    const paint = new canvasKit.Paint()
    paint.setImageFilter(canvasKit.ImageFilter.MakeBlur(blur, blur, canvasKit.TileMode.Decal, null))
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
    const paragraph = buildParagraph(canvasKit, node, rect.width)
    if (paragraph) {
      canvas.drawParagraph(paragraph, rect.x, rect.y)
      paragraph.delete()
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

  for (const item of sceneItems(scene.document)) {
    const alpha = revealAlpha(item.node.id, now)
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

  paintOverlay(canvasKit, canvas, scene.viewport, scene.overlay)

  canvas.restore()
  surface.flush()
}

export function renderNodePng(canvasKit: CanvasKit, document: Document, id: string, scale = 2): string | null {
  const items = sceneItems(document)
  const root = items.find((item) => item.node.id === id)
  if (!root || root.width <= 0 || root.height <= 0) {
    return null
  }

  const surface = canvasKit.MakeSurface(Math.ceil(root.width * scale), Math.ceil(root.height * scale))
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
  surface.delete()

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
