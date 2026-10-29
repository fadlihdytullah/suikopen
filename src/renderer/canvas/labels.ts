import type { Canvas, CanvasKit, Paragraph } from 'canvaskit-wasm'
import type { Document } from '../../shared/schema/document'
import { hasChildren, type Node } from '../../shared/schema/node'
import { DEFAULT_FAMILY, fontGeneration, fontManager } from '../text/font-manager'
import { layerName } from '../ui/LayersPanel'
import { canvasIsDark } from './canvas-theme'
import { sceneItems, type Rect, type SceneItem } from './scene-index'
import { toScreen, type Viewport } from './viewport'

export type Label = { item: SceneItem; component: boolean }

const FONT_SIZE = 12
const HEIGHT = 16
const GAP = 4
const MIN_WIDTH = 40
const ICON = 12
const COMPONENT: [number, number, number, number] = [0.68, 0.48, 1, 1]

const masterCache = new WeakMap<Document, Set<string>>()
const labelCache = new WeakMap<Document, WeakMap<Document, Label[]>>()

function masterIds(raw: Document): Set<string> {
  let ids = masterCache.get(raw)
  if (!ids) {
    const found = new Set<string>()
    const visit = (nodes: Node[]): void => {
      for (const node of nodes) {
        if (node.type === 'ref') {
          found.add(node.masterId)
        }
        if (hasChildren(node)) {
          visit(node.children)
        }
      }
    }
    visit(raw.children)
    ids = found
    masterCache.set(raw, ids)
  }
  return ids
}

export function labelsOf(resolved: Document, raw: Document): Label[] {
  let byRaw = labelCache.get(resolved)
  if (!byRaw) {
    byRaw = new WeakMap()
    labelCache.set(resolved, byRaw)
  }
  let labels = byRaw.get(raw)
  if (!labels) {
    const masters = masterIds(raw)
    labels = sceneItems(resolved)
      .filter((item) => masters.has(item.node.id) || (item.parentId === null && item.node.type === 'frame'))
      .map((item) => ({ item, component: masters.has(item.node.id) }))
    byRaw.set(raw, labels)
  }
  return labels
}

export function labelBox(viewport: Viewport, item: Rect): Rect | null {
  const width = item.width * viewport.scale
  if (width < MIN_WIDTH) {
    return null
  }
  const topLeft = toScreen(viewport, item)
  return { x: topLeft.x, y: topLeft.y - GAP - HEIGHT, width, height: HEIGHT }
}

export function labelAt(labels: Label[], viewport: Viewport, screen: { x: number; y: number }): SceneItem | null {
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const { item } = labels[index]!
    const box = labelBox(viewport, item)
    if (!item.locked && box && screen.x >= box.x && screen.x <= box.x + box.width && screen.y >= box.y && screen.y <= box.y + box.height) {
      return item
    }
  }
  return null
}

type Cached = { paragraph: Paragraph; used: boolean }

const paragraphs = new Map<string, Cached>()

function paragraph(canvasKit: CanvasKit, text: string, color: [number, number, number, number], width: number): Paragraph | null {
  const manager = fontManager()
  if (!manager) {
    return null
  }
  const key = `${fontGeneration()}|${color.join(',')}|${Math.floor(width)}|${text}`
  const cached = paragraphs.get(key)
  if (cached) {
    cached.used = true
    return cached.paragraph
  }
  const style = new canvasKit.ParagraphStyle({
    textStyle: { color: canvasKit.Color4f(...color), fontFamilies: [DEFAULT_FAMILY], fontSize: FONT_SIZE },
    maxLines: 1,
    ellipsis: '…',
  })
  const builder = canvasKit.ParagraphBuilder.Make(style, manager)
  builder.addText(text)
  const built = builder.build()
  builder.delete()
  built.layout(Math.max(1, Math.floor(width)))
  paragraphs.set(key, { paragraph: built, used: true })
  return built
}

function sweep(): void {
  for (const [key, entry] of paragraphs) {
    if (entry.used) {
      entry.used = false
    } else {
      entry.paragraph.delete()
      paragraphs.delete(key)
    }
  }
}

function paintIcon(canvasKit: CanvasKit, canvas: Canvas, x: number, y: number): void {
  const half = ICON / 2
  const cx = x + half
  const cy = y + half
  const quarter = half / 2
  const builder = new canvasKit.PathBuilder()
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const px = cx + dx * quarter
    const py = cy + dy * quarter
    builder.moveTo(px, py - quarter)
    builder.lineTo(px + quarter, py)
    builder.lineTo(px, py + quarter)
    builder.lineTo(px - quarter, py)
    builder.close()
  }
  const path = builder.detach()
  const paint = new canvasKit.Paint()
  paint.setStyle(canvasKit.PaintStyle.Stroke)
  paint.setStrokeWidth(1.2)
  paint.setAntiAlias(true)
  paint.setColor(canvasKit.Color4f(...COMPONENT))
  canvas.drawPath(path, paint)
  paint.delete()
  path.delete()
}

export function paintLabels(canvasKit: CanvasKit, canvas: Canvas, viewport: Viewport, labels: Label[]): void {
  const frameColor: [number, number, number, number] = canvasIsDark() ? [1, 1, 1, 0.55] : [0, 0, 0, 0.55]

  for (const { item, component } of labels) {
    const box = labelBox(viewport, item)
    if (!box) {
      continue
    }
    const offset = component ? ICON + GAP : 0
    const text = paragraph(canvasKit, layerName(item.node), component ? COMPONENT : frameColor, box.width - offset)
    if (component) {
      paintIcon(canvasKit, canvas, box.x, box.y + (HEIGHT - ICON) / 2)
    }
    if (text) {
      canvas.drawParagraph(text, box.x + offset, box.y + (HEIGHT - text.getHeight()) / 2)
    }
  }

  sweep()
}
