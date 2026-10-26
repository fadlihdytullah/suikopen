import type { Rect } from '../canvas/scene-index'

export type Guide = { axis: 'x' | 'y'; position: number; from: number; to: number }
export type SnapResult = { dx: number; dy: number; guides: Guide[] }

type Line = { position: number; from: number; to: number }

function xLines(rect: Rect): Line[] {
  const span = { from: rect.y, to: rect.y + rect.height }
  return [rect.x, rect.x + rect.width / 2, rect.x + rect.width].map((position) => ({ position, ...span }))
}

function yLines(rect: Rect): Line[] {
  const span = { from: rect.x, to: rect.x + rect.width }
  return [rect.y, rect.y + rect.height / 2, rect.y + rect.height].map((position) => ({ position, ...span }))
}

function bestAxis(moving: Line[], candidates: Line[], threshold: number): { delta: number; guide: Line | null } {
  let delta = 0
  let distance = threshold
  let guide: Line | null = null

  for (const line of moving) {
    for (const candidate of candidates) {
      const gap = candidate.position - line.position
      if (Math.abs(gap) < distance) {
        distance = Math.abs(gap)
        delta = gap
        guide = {
          position: candidate.position,
          from: Math.min(candidate.from, line.from),
          to: Math.max(candidate.to, line.to),
        }
      }
    }
  }

  return { delta, guide }
}

export function snapRect(moving: Rect, candidates: Rect[], threshold: number): SnapResult {
  const horizontal = bestAxis(xLines(moving), candidates.flatMap(xLines), threshold)
  const vertical = bestAxis(yLines(moving), candidates.flatMap(yLines), threshold)

  const guides: Guide[] = []
  if (horizontal.guide) {
    guides.push({ axis: 'x', ...horizontal.guide })
  }
  if (vertical.guide) {
    guides.push({ axis: 'y', ...vertical.guide })
  }

  return { dx: horizontal.delta, dy: vertical.delta, guides }
}
