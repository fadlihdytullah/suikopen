import type { Canvas, CanvasKit, Path } from 'canvaskit-wasm'
import { toArray, type EffectsValue, type StrokeValue } from '../../shared/schema/node'
import { parseHexColor } from './color'

const SHADOW_DEFAULT = '#00000040'

function color4f(canvasKit: CanvasKit, hex: string): Float32Array {
  const [r, g, b, a] = parseHexColor(hex)
  return canvasKit.Color4f(r, g, b, a)
}

export function layerBlurRadius(effects: EffectsValue | undefined): number {
  return toArray(effects)
    .filter((effect) => effect.enabled !== false && effect.type === 'blur')
    .reduce((largest, effect) => Math.max(largest, effect.type === 'blur' ? effect.radius : 0), 0)
}

export function paintOuterShadows(
  canvasKit: CanvasKit,
  canvas: Canvas,
  path: Path,
  effects: EffectsValue | undefined
): void {
  for (const effect of toArray(effects)) {
    if (effect.enabled === false || effect.type !== 'shadow' || (effect.shadowType ?? 'outer') !== 'outer') {
      continue
    }

    const paint = new canvasKit.Paint()
    paint.setColor(color4f(canvasKit, effect.color ?? SHADOW_DEFAULT))
    paint.setAntiAlias(true)
    if (effect.blur) {
      paint.setMaskFilter(canvasKit.MaskFilter.MakeBlur(canvasKit.BlurStyle.Normal, effect.blur / 2, true))
    }

    canvas.save()
    canvas.translate(effect.offset?.x ?? 0, effect.offset?.y ?? 0)
    canvas.drawPath(path, paint)
    canvas.restore()
    paint.delete()
  }
}

export function paintInnerShadows(
  canvasKit: CanvasKit,
  canvas: Canvas,
  path: Path,
  effects: EffectsValue | undefined
): void {
  const shadows = toArray(effects).filter(
    (effect) => effect.enabled !== false && effect.type === 'shadow' && effect.shadowType === 'inner'
  )

  if (shadows.length === 0) {
    return
  }

  canvas.save()
  canvas.clipPath(path, canvasKit.ClipOp.Intersect, true)

  for (const effect of shadows) {
    if (effect.type !== 'shadow') {
      continue
    }

    const paint = new canvasKit.Paint()
    paint.setColor(color4f(canvasKit, effect.color ?? SHADOW_DEFAULT))
    paint.setAntiAlias(true)
    paint.setStyle(canvasKit.PaintStyle.Stroke)
    paint.setStrokeWidth(Math.max(1, (effect.blur ?? 0) * 2))
    if (effect.blur) {
      paint.setMaskFilter(canvasKit.MaskFilter.MakeBlur(canvasKit.BlurStyle.Normal, effect.blur / 2, true))
    }

    canvas.save()
    canvas.translate(effect.offset?.x ?? 0, effect.offset?.y ?? 0)
    canvas.drawPath(path, paint)
    canvas.restore()
    paint.delete()
  }

  canvas.restore()
}

export function paintStroke(
  canvasKit: CanvasKit,
  canvas: Canvas,
  path: Path,
  stroke: StrokeValue | undefined
): void {
  if (!stroke || stroke.enabled === false) {
    return
  }

  const width = stroke.width ?? 1
  if (width <= 0) {
    return
  }

  const align = stroke.align ?? 'center'
  const paint = new canvasKit.Paint()
  paint.setColor(color4f(canvasKit, stroke.color))
  paint.setAntiAlias(true)
  paint.setStyle(canvasKit.PaintStyle.Stroke)
  paint.setStrokeWidth(align === 'center' ? width : width * 2)

  canvas.save()
  if (align === 'inside') {
    canvas.clipPath(path, canvasKit.ClipOp.Intersect, true)
  } else if (align === 'outside') {
    canvas.clipPath(path, canvasKit.ClipOp.Difference, true)
  }
  canvas.drawPath(path, paint)
  canvas.restore()

  paint.delete()
}
