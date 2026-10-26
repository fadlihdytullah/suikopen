import type { TextNodeValue } from '../../shared/schema/node'

export type TextMeasurer = (node: TextNodeValue, availableWidth: number) => { width: number; height: number } | null

let measurer: TextMeasurer | null = null

export function setTextMeasurer(next: TextMeasurer | null): void {
  measurer = next
}

export function measureText(
  node: TextNodeValue,
  availableWidth: number
): { width: number; height: number } | null {
  return measurer ? measurer(node, availableWidth) : null
}
