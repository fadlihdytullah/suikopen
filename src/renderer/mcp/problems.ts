import { asNumber, toArray, type Node } from '../../shared/schema/node'
import { intersects, type SceneItem } from '../canvas/scene-index'
import { parseHexColor } from '../canvas/color'

export type Problem = { id: string; name?: string; issue: string }

const MAX_PROBLEMS = 12
const TOLERANCE = 0.5

function solidHex(node: Node): string | null {
  const fills = toArray(node.fill)
  for (let index = fills.length - 1; index >= 0; index -= 1) {
    const fill = fills[index]
    if (typeof fill === 'string' && fill.startsWith('#')) {
      return fill
    }
    if (typeof fill === 'object' && fill.type === 'color' && fill.enabled !== false && typeof fill.color === 'string') {
      return fill.color
    }
    if (typeof fill === 'object' && fill.enabled !== false) {
      return null
    }
  }
  return null
}

function luminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ) as [number, number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [number, number]
  return (a + 0.05) / (b + 0.05)
}

function opaque(hex: string): boolean {
  return parseHexColor(hex)[3] >= 0.99
}

function label(item: SceneItem): Pick<Problem, 'id' | 'name'> {
  return item.node.name === undefined ? { id: item.node.id } : { id: item.node.id, name: item.node.name }
}

export function findProblems(items: SceneItem[], rootId: string): Problem[] {
  const byId = new Map(items.map((item) => [item.node.id, item]))
  const inside = new Set([rootId])
  const scope: SceneItem[] = []

  for (const item of items) {
    if (item.node.id === rootId || (item.parentId !== null && inside.has(item.parentId))) {
      if (item.node.visible === false) {
        continue
      }
      inside.add(item.node.id)
      scope.push(item)
    }
  }

  const problems: Problem[] = []
  const add = (item: SceneItem, issue: string) => {
    if (problems.length < MAX_PROBLEMS) {
      problems.push({ ...label(item), issue })
    }
  }

  for (const item of scope) {
    const parent = item.parentId === null ? undefined : byId.get(item.parentId)

    if (item.width < 1 || item.height < 1) {
      add(item, `collapsed to ${Math.round(item.width)}x${Math.round(item.height)}; give it a size or fill_container inside a parent that has one`)
      continue
    }

    if (parent && parent.node.type === 'frame') {
      const right = item.x + item.width - (parent.x + parent.width)
      const bottom = item.y + item.height - (parent.y + parent.height)
      const left = parent.x - item.x
      const top = parent.y - item.y
      const overflow = Math.max(right, bottom, left, top)
      if (overflow > TOLERANCE) {
        add(item, `sticks out of "${parent.node.name ?? parent.node.id}" by ${Math.round(overflow)}px; resize the parent (fit_content) or the node`)
      }
    }

    if (item.node.type === 'text') {
      const color = solidHex(item.node) ?? '#000000'
      let background: string | null = null
      for (let current = parent; current; current = current.parentId === null ? undefined : byId.get(current.parentId)) {
        const hex = solidHex(current.node)
        if (hex && opaque(hex)) {
          background = hex
          break
        }
        if (toArray(current.node.fill).length > 0) {
          break
        }
      }
      const size = asNumber(item.node.fontSize, 14)
      const large = size >= 24 || (size >= 18.66 && (item.node.fontWeight ?? 400) >= 700)
      const minimum = large ? 3 : 4.5
      if (background && opaque(color)) {
        const ratio = contrastRatio(color, background)
        if (ratio < minimum) {
          add(item, `text contrast ${ratio.toFixed(1)}:1 on ${background}, needs ${minimum}:1`)
        }
      }
    }
  }

  const siblings = new Map<string, SceneItem[]>()
  for (const item of scope) {
    const parent = item.parentId === null ? undefined : byId.get(item.parentId)
    if (!parent || item.node.id === rootId || (parent.node.type === 'frame' && (parent.node.layout ?? 'none') !== 'none')) {
      continue
    }
    if (item.node.type === 'text') {
      siblings.set(parent.node.id, [...(siblings.get(parent.node.id) ?? []), item])
    }
  }
  for (const texts of siblings.values()) {
    texts.forEach((a, index) => {
      texts.slice(index + 1).forEach((b) => {
        if (intersects(a, b)) {
          add(a, `overlaps text "${b.node.name ?? b.node.id}"; use auto layout instead of x/y`)
        }
      })
    })
  }

  return problems
}
