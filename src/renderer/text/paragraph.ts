import type { CanvasKit, Paragraph } from 'canvaskit-wasm'
import { asNumber, type TextNodeValue } from '../../shared/schema/node'
import { parseHexColor } from '../canvas/color'
import { DEFAULT_FAMILY, fontManager, requestFont } from './font-manager'

const ALIGN = { left: 0, right: 1, center: 2 } as const

export function buildParagraph(canvasKit: CanvasKit, node: TextNodeValue, width: number): Paragraph | null {
  const manager = fontManager()
  const family = node.fontFamily ?? DEFAULT_FAMILY
  const weight = node.fontWeight ?? 400
  const italic = node.fontStyle === 'italic'

  requestFont(canvasKit, family, weight, italic)

  if (!manager) {
    return null
  }

  const colorSource = typeof node.fill === 'string' ? node.fill : '#000000'
  const [r, g, b, a] = parseHexColor(colorSource)

  const style = new canvasKit.ParagraphStyle({
    textStyle: {
      color: canvasKit.Color4f(r, g, b, a),
      fontFamilies: [family, DEFAULT_FAMILY],
      fontSize: asNumber(node.fontSize, 16),
      fontStyle: {
        weight: { value: weight },
        slant: italic ? canvasKit.FontSlant.Italic : canvasKit.FontSlant.Upright,
      },
      ...(node.letterSpacing === undefined ? {} : { letterSpacing: node.letterSpacing }),
      ...(node.lineHeight === undefined ? {} : { heightMultiplier: node.lineHeight }),
    },
    textAlign: { value: ALIGN[node.textAlign ?? 'left'] },
  })

  const builder = canvasKit.ParagraphBuilder.Make(style, manager)
  builder.addText(node.content)
  const paragraph = builder.build()
  builder.delete()

  paragraph.layout(width)

  return paragraph
}

export function measureParagraph(
  canvasKit: CanvasKit,
  node: TextNodeValue,
  availableWidth: number
): { width: number; height: number } | null {
  const paragraph = buildParagraph(canvasKit, node, Number.isFinite(availableWidth) ? availableWidth : 1e5)
  if (!paragraph) {
    return null
  }

  const size = { width: Math.ceil(paragraph.getMaxIntrinsicWidth()), height: Math.ceil(paragraph.getHeight()) }
  paragraph.delete()

  return size
}
