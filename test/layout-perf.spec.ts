import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildLargeDocument, BENCHMARK_NODE_COUNT } from '../bench/large-document'
import { computeLayout, layoutCacheSize, resetLayoutCache } from '../src/renderer/layout/yoga-tree'
import { sceneItems } from '../src/renderer/canvas/scene-index'

const RELAYOUT_BUDGET_MS = 8

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

describe('layout performance', () => {
  const document = buildLargeDocument()

  it('builds the benchmark document at the expected size', () => {
    expect(sceneItems(document).length).toBeGreaterThanOrEqual(BENCHMARK_NODE_COUNT - 100)
  })

  it('relayouts the whole document inside a frame budget', () => {
    computeLayout(document)

    const samples: number[] = []

    for (let run = 0; run < 20; run += 1) {
      const edited = produce(document, (draft) => {
        const frame = draft.children[0]
        if (frame && frame.type === 'frame') {
          const child = frame.children[0]
          if (child) {
            child.height = 24 + run
          }
        }
      })

      const started = performance.now()
      computeLayout(edited)
      samples.push(performance.now() - started)
    }

    const result = median(samples)
    // eslint-disable-next-line no-console
    console.log(`relayout of ${sceneItems(document).length} nodes: ${result.toFixed(2)}ms median`)

    expect(result).toBeLessThan(RELAYOUT_BUDGET_MS)
  })

  it('does not grow the yoga cache across many edits', () => {
    resetLayoutCache()

    let current = document
    computeLayout(current)
    const baseline = layoutCacheSize()

    for (let run = 0; run < 200; run += 1) {
      current = produce(current, (draft) => {
        const frame = draft.children[run % draft.children.length]
        if (frame && frame.type === 'frame') {
          const child = frame.children[run % frame.children.length]
          if (child) {
            child.height = 20 + (run % 40)
          }
        }
      })
      computeLayout(current)
    }

    expect(layoutCacheSize()).toBe(baseline)
  })

  it('memoises the scene index so repeated reads are free', () => {
    const first = sceneItems(document)
    const started = performance.now()
    for (let run = 0; run < 1000; run += 1) {
      sceneItems(document)
    }
    const elapsed = performance.now() - started

    expect(sceneItems(document)).toBe(first)
    expect(elapsed).toBeLessThan(5)
  })
})
