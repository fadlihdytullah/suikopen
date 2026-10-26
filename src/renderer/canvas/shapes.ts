import type { CanvasKit, Path } from 'canvaskit-wasm'
import { cornerRadii, type CornerRadiusValue, type Node } from '../../shared/schema/node'
import type { Rect } from './scene-index'

export function nodePath(canvasKit: CanvasKit, node: Node, rect: Rect): Path {
  const builder = new canvasKit.PathBuilder()
  const bounds = canvasKit.LTRBRect(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)

  if (node.type === 'ellipse') {
    builder.addOval(bounds)
    return builder.detach()
  }

  const radius: CornerRadiusValue | undefined =
    node.type === 'frame' || node.type === 'rectangle' ? node.cornerRadius : undefined
  const [topLeft, topRight, bottomRight, bottomLeft] = cornerRadii(radius)

  if (topLeft + topRight + bottomRight + bottomLeft === 0) {
    builder.addRect(bounds)
    return builder.detach()
  }

  builder.addRRect(
    Float32Array.of(
      rect.x,
      rect.y,
      rect.x + rect.width,
      rect.y + rect.height,
      topLeft,
      topLeft,
      topRight,
      topRight,
      bottomRight,
      bottomRight,
      bottomLeft,
      bottomLeft
    )
  )

  return builder.detach()
}
