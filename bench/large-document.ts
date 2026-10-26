import { parseDocument, type Document } from '../src/shared/schema/document'

export const BENCHMARK_NODE_COUNT = 5000

export function buildLargeDocument(total = BENCHMARK_NODE_COUNT): Document {
  const frames: unknown[] = []
  const perFrame = 50
  const frameCount = Math.floor(total / perFrame)

  for (let frame = 0; frame < frameCount; frame += 1) {
    const children: unknown[] = []

    for (let child = 0; child < perFrame - 1; child += 1) {
      children.push({
        id: `n-${frame}-${child}`,
        type: child % 3 === 0 ? 'ellipse' : 'rectangle',
        x: 0,
        y: 0,
        width: child % 5 === 0 ? 'fill_container(80)' : 80,
        height: 24,
        fill: '#2f6fed',
      })
    }

    frames.push({
      id: `frame-${frame}`,
      type: 'frame',
      x: (frame % 10) * 240,
      y: Math.floor(frame / 10) * 1400,
      width: 220,
      height: 'fit_content(100)',
      fill: '#14161a',
      layout: 'vertical',
      gap: 4,
      padding: 8,
      children,
    })
  }

  return parseDocument({ version: 1, children: frames })
}
