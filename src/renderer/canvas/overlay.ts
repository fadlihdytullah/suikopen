import type { Canvas, CanvasKit } from 'canvaskit-wasm'
import type { Guide } from '../tools/snapping'
import { HANDLES, handlePoint } from '../tools/transform'
import type { Rect, SceneItem } from './scene-index'
import { toScreen, type Viewport } from './viewport'
import { cornerRadii, hasChildren } from '../../shared/schema/node'

const ACCENT: [number, number, number, number] = [0.247, 0.541, 1, 1]
const GUIDE: [number, number, number, number] = [1, 0.278, 0.439, 1]
const HANDLE_SIZE = 7

export type OverlayScene = {
  selected: SceneItem[]
  marquee: Rect | null
  guides: Guide[]
  agentFocus?: AgentFocus | null
}

const AGENT: [number, number, number, number] = [0.851, 0.467, 0.341, 1]

const BLOBS: { color: [number, number, number]; speed: number; phase: number }[] = [
  { color: [0.851, 0.467, 0.341], speed: 0.00042, phase: 0 },
  { color: [0.62, 0.45, 0.95], speed: 0.00031, phase: 2.1 },
  { color: [0.35, 0.56, 1], speed: 0.00037, phase: 4.2 },
  { color: [0.95, 0.46, 0.66], speed: 0.00027, phase: 1.3 },
]

const reducedMotion = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)')

export type AgentFocus = { item: SceneItem; alpha: number }

function focusRRect(canvasKit: CanvasKit, item: SceneItem, rect: Rect, scale: number, inset = 0): Float32Array {
  const radius = item.node.type === 'frame' || item.node.type === 'rectangle' ? item.node.cornerRadius : undefined
  const [tl, tr, br, bl] = cornerRadii(radius).map((value) => Math.max(0, value * scale - inset))
  if (item.node.type === 'ellipse') {
    return canvasKit.RRectXY(canvasKit.LTRBRect(rect.x + inset, rect.y + inset, rect.x + rect.width - inset, rect.y + rect.height - inset), rect.width / 2, rect.height / 2)
  }
  return Float32Array.of(rect.x + inset, rect.y + inset, rect.x + rect.width - inset, rect.y + rect.height - inset, tl!, tl!, tr!, tr!, br!, br!, bl!, bl!)
}

function paintAgentFocus(canvasKit: CanvasKit, canvas: Canvas, viewport: Viewport, focus: AgentFocus): void {
  const { item, alpha } = focus
  const rect = screenRect(viewport, item)
  const now = reducedMotion?.matches ? 0 : performance.now()
  const empty = !hasChildren(item.node) || item.node.children.length === 0
  const strength = empty ? 1 : 0.28
  const shape = focusRRect(canvasKit, item, rect, viewport.scale)

  canvas.save()
  canvas.clipRRect(shape, canvasKit.ClipOp.Intersect, true)

  const base = new canvasKit.Paint()
  base.setColor(canvasKit.Color4f(0.075, 0.078, 0.098, 0.94 * strength * alpha))
  canvas.drawRRect(shape, base)
  base.delete()

  const size = Math.max(rect.width, rect.height)
  const blob = new canvasKit.Paint()
  blob.setAntiAlias(true)
  blob.setBlendMode(canvasKit.BlendMode.Plus)
  for (const { color, speed, phase } of BLOBS) {
    const t = now * speed + phase
    const center: [number, number] = [rect.x + rect.width * (0.5 + 0.38 * Math.sin(t * 1.3)), rect.y + rect.height * (0.5 + 0.38 * Math.cos(t))]
    const radius = size * (0.42 + 0.08 * Math.sin(t * 1.7))
    const shader = canvasKit.Shader.MakeRadialGradient(
      center,
      radius,
      [canvasKit.Color4f(color[0], color[1], color[2], 0.55 * strength * alpha), canvasKit.Color4f(color[0], color[1], color[2], 0)],
      null,
      canvasKit.TileMode.Clamp
    )
    blob.setShader(shader)
    canvas.drawRRect(shape, blob)
    shader.delete()
  }
  blob.delete()
  canvas.restore()

  const pulse = reducedMotion?.matches ? 1 : 0.7 + 0.3 * Math.sin(performance.now() / 420)
  const glow = new canvasKit.Paint()
  glow.setColor(canvasKit.Color4f(AGENT[0], AGENT[1], AGENT[2], 0.55 * pulse * alpha))
  glow.setStyle(canvasKit.PaintStyle.Stroke)
  glow.setStrokeWidth(4)
  glow.setAntiAlias(true)
  glow.setMaskFilter(canvasKit.MaskFilter.MakeBlur(canvasKit.BlurStyle.Normal, 6, true))
  canvas.drawRRect(shape, glow)

  const line = new canvasKit.Paint()
  line.setColor(canvasKit.Color4f(AGENT[0], AGENT[1], AGENT[2], 0.9 * alpha))
  line.setStyle(canvasKit.PaintStyle.Stroke)
  line.setStrokeWidth(1)
  line.setAntiAlias(true)
  canvas.drawRRect(shape, line)

  const pill = new canvasKit.Paint()
  pill.setColor(canvasKit.Color4f(AGENT[0], AGENT[1], AGENT[2], alpha))
  pill.setAntiAlias(true)
  const pillBox = canvasKit.LTRBRect(rect.x, rect.y - 22, rect.x + 52, rect.y - 6)
  canvas.drawRRect(canvasKit.RRectXY(pillBox, 8, 8), pill)

  const dot = new canvasKit.Paint()
  dot.setAntiAlias(true)
  for (let index = 0; index < 3; index += 1) {
    const phase = reducedMotion?.matches ? 0 : (performance.now() / 160 + index) % 3
    dot.setColor(canvasKit.Color4f(1, 1, 1, (phase < 1 ? 1 : 0.45) * alpha))
    canvas.drawCircle(rect.x + 17 + index * 9, rect.y - 14, 2, dot)
  }

  glow.delete()
  line.delete()
  pill.delete()
  dot.delete()
}

function screenRect(viewport: Viewport, rect: Rect): Rect {
  const topLeft = toScreen(viewport, { x: rect.x, y: rect.y })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width * viewport.scale,
    height: rect.height * viewport.scale,
  }
}

export function paintOverlay(
  canvasKit: CanvasKit,
  canvas: Canvas,
  viewport: Viewport,
  scene: OverlayScene
): void {
  const stroke = new canvasKit.Paint()
  stroke.setColor(canvasKit.Color4f(...ACCENT))
  stroke.setStyle(canvasKit.PaintStyle.Stroke)
  stroke.setStrokeWidth(1)
  stroke.setAntiAlias(false)

  const fill = new canvasKit.Paint()
  fill.setColor(canvasKit.Color4f(1, 1, 1, 1))
  fill.setAntiAlias(true)

  const guidePaint = new canvasKit.Paint()
  guidePaint.setColor(canvasKit.Color4f(...GUIDE))
  guidePaint.setStyle(canvasKit.PaintStyle.Stroke)
  guidePaint.setStrokeWidth(1)
  guidePaint.setAntiAlias(false)

  for (const item of scene.selected) {
    const rect = screenRect(viewport, item)
    canvas.drawRect(canvasKit.LTRBRect(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height), stroke)
  }

  if (scene.selected.length > 0) {
    const bounds = screenRect(viewport, boundsOf(scene.selected))

    if (scene.selected.length > 1) {
      canvas.drawRect(
        canvasKit.LTRBRect(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height),
        stroke
      )
    }

    for (const handle of HANDLES) {
      const point = handlePoint(bounds, handle)
      const half = HANDLE_SIZE / 2
      const box = canvasKit.LTRBRect(point.x - half, point.y - half, point.x + half, point.y + half)
      canvas.drawRect(box, fill)
      canvas.drawRect(box, stroke)
    }
  }

  for (const guide of scene.guides) {
    const start = toScreen(viewport, guide.axis === 'x' ? { x: guide.position, y: guide.from } : { x: guide.from, y: guide.position })
    const end = toScreen(viewport, guide.axis === 'x' ? { x: guide.position, y: guide.to } : { x: guide.to, y: guide.position })
    canvas.drawLine(start.x, start.y, end.x, end.y, guidePaint)
  }

  if (scene.marquee) {
    const rect = screenRect(viewport, scene.marquee)
    const box = canvasKit.LTRBRect(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)
    const wash = new canvasKit.Paint()
    wash.setColor(canvasKit.Color4f(ACCENT[0], ACCENT[1], ACCENT[2], 0.12))
    canvas.drawRect(box, wash)
    canvas.drawRect(box, stroke)
    wash.delete()
  }

  if (scene.agentFocus) {
    paintAgentFocus(canvasKit, canvas, viewport, scene.agentFocus)
  }

  stroke.delete()
  fill.delete()
  guidePaint.delete()
}

function boundsOf(items: SceneItem[]): Rect {
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
