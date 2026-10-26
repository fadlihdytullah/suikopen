import type { PaddingValue, SizingValue } from '../../shared/schema/node'

export type Sizing =
  | { kind: 'fixed'; value: number }
  | { kind: 'fit_content'; fallback: number | null }
  | { kind: 'fill_container'; fallback: number | null }

const PATTERN = /^(fit_content|fill_container)(?:\((\d+(?:\.\d+)?)\))?$/

export function parseSizing(value: SizingValue): Sizing {
  if (typeof value === 'number') {
    return { kind: 'fixed', value }
  }

  const match = PATTERN.exec(value)
  if (!match) {
    return { kind: 'fixed', value: 0 }
  }

  return {
    kind: match[1] as 'fit_content' | 'fill_container',
    fallback: match[2] === undefined ? null : Number(match[2]),
  }
}

export type Edges = { top: number; right: number; bottom: number; left: number }

export function parsePadding(value: PaddingValue | undefined): Edges {
  if (value === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }

  if (typeof value === 'number') {
    return { top: value, right: value, bottom: value, left: value }
  }

  if (value.length === 2) {
    const [vertical, horizontal] = value
    return { top: vertical, right: horizontal, bottom: vertical, left: horizontal }
  }

  const [top, right, bottom, left] = value
  return { top, right, bottom, left }
}
