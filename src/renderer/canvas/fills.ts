import type { CanvasKit, Paint } from 'canvaskit-wasm'
import { toArray, type FillsValue, type FillValue } from '../../shared/schema/node'
import { parseHexColor } from './color'
import { getImage } from './image-cache'
import type { Rect } from './scene-index'

function color4f(canvasKit: CanvasKit, hex: string, opacity = 1): Float32Array {
  const [r, g, b, a] = parseHexColor(hex)
  return canvasKit.Color4f(r, g, b, a * opacity)
}

function gradientPoints(rect: Rect, rotationDegrees: number): [Float32Array, Float32Array] {
  const radians = ((rotationDegrees + 90) * Math.PI) / 180
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const reach = Math.abs(Math.cos(radians) * rect.width) / 2 + Math.abs(Math.sin(radians) * rect.height) / 2
  const dx = Math.cos(radians) * reach
  const dy = Math.sin(radians) * reach

  return [
    Float32Array.of(centerX - dx, centerY - dy),
    Float32Array.of(centerX + dx, centerY + dy),
  ]
}

function buildPaint(canvasKit: CanvasKit, fill: FillValue, rect: Rect, alpha: number): Paint | null {
  const paint = new canvasKit.Paint()
  paint.setAntiAlias(true)

  if (typeof fill === 'string') {
    paint.setColor(color4f(canvasKit, fill, alpha))
    return paint
  }

  if (fill.enabled === false) {
    paint.delete()
    return null
  }

  const opacity = (fill.opacity ?? 1) * alpha

  if (fill.type === 'color') {
    paint.setColor(color4f(canvasKit, fill.color, opacity))
    return paint
  }

  if (fill.type === 'gradient') {
    const colors = fill.colors.map((stop) => color4f(canvasKit, stop.color, opacity))
    const positions = fill.colors.map((stop) => stop.position)
    const kind = fill.gradientType ?? 'linear'

    if (kind === 'radial') {
      const center = Float32Array.of(rect.x + rect.width / 2, rect.y + rect.height / 2)
      paint.setShader(
        canvasKit.Shader.MakeRadialGradient(
          center,
          Math.max(rect.width, rect.height) / 2,
          colors,
          positions,
          canvasKit.TileMode.Clamp
        )
      )
      return paint
    }

    if (kind === 'angular') {
      paint.setShader(
        canvasKit.Shader.MakeSweepGradient(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          colors,
          positions,
          canvasKit.TileMode.Clamp
        )
      )
      return paint
    }

    const [start, end] = gradientPoints(rect, fill.rotation ?? 0)
    paint.setShader(canvasKit.Shader.MakeLinearGradient(start, end, colors, positions, canvasKit.TileMode.Clamp))
    return paint
  }

  const image = getImage(canvasKit, fill.url)
  if (!image) {
    paint.delete()
    return null
  }

  const mode = fill.mode ?? 'cover'
  const imageWidth = image.width()
  const imageHeight = image.height()
  const scaleX = rect.width / imageWidth
  const scaleY = rect.height / imageHeight
  const scale =
    mode === 'stretch' ? null : mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)

  const sx = scale ?? scaleX
  const sy = scale ?? scaleY
  const matrix = canvasKit.Matrix.multiply(
    canvasKit.Matrix.translated(
      rect.x + (rect.width - imageWidth * sx) / 2,
      rect.y + (rect.height - imageHeight * sy) / 2
    ),
    canvasKit.Matrix.scaled(sx, sy)
  )

  paint.setShader(
    image.makeShaderOptions(
      canvasKit.TileMode.Decal,
      canvasKit.TileMode.Decal,
      canvasKit.FilterMode.Linear,
      canvasKit.MipmapMode.None,
      matrix
    )
  )
  paint.setAlphaf(opacity)

  return paint
}

export function fillPaints(canvasKit: CanvasKit, fills: FillsValue | undefined, rect: Rect, alpha = 1): Paint[] {
  return toArray(fills)
    .map((fill) => buildPaint(canvasKit, fill, rect, alpha))
    .filter((paint): paint is Paint => paint !== null)
}
