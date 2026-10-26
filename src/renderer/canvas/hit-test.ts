import { contains, parentChain, within, type Rect, type SceneItem } from './scene-index'

export function hitTest(items: SceneItem[], point: { x: number; y: number }): SceneItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (item.node.type !== 'group' && !item.locked && contains(item, point)) {
      return item
    }
  }
  return null
}

export function itemsWithin(items: SceneItem[], marquee: Rect): SceneItem[] {
  const enclosed = items.filter((item) => !item.locked && within(marquee, item))
  const enclosedIds = new Set(enclosed.map((item) => item.node.id))

  return enclosed.filter((item) => !parentChain(items, item.node.id).some((id) => enclosedIds.has(id)))
}
