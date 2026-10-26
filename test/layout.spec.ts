import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocument, type Document } from '../src/shared/schema/document'
import { computeLayout } from '../src/renderer/layout/yoga-tree'
import { parsePadding, parseSizing } from '../src/renderer/layout/sizing'

const fixture = parseDocument(
  JSON.parse(readFileSync(new URL('../fixtures/hello.spen', import.meta.url), 'utf8'))
)

function document(children: unknown[]): Document {
  return parseDocument({ version: 1, children })
}

const box = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 40,
  height: 20,
  ...extra,
})

describe('parseSizing', () => {
  it('reads numbers, behaviors and fallbacks', () => {
    expect(parseSizing(120)).toEqual({ kind: 'fixed', value: 120 })
    expect(parseSizing('fit_content')).toEqual({ kind: 'fit_content', fallback: null })
    expect(parseSizing('fill_container(200)')).toEqual({ kind: 'fill_container', fallback: 200 })
  })
})

describe('parsePadding', () => {
  it('expands every shorthand form', () => {
    expect(parsePadding(8)).toEqual({ top: 8, right: 8, bottom: 8, left: 8 })
    expect(parsePadding([10, 20])).toEqual({ top: 10, right: 20, bottom: 10, left: 20 })
    expect(parsePadding([1, 2, 3, 4])).toEqual({ top: 1, right: 2, bottom: 3, left: 4 })
    expect(parsePadding(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })
})

describe('computeLayout', () => {
  it('keeps absolute children exactly where the document puts them', () => {
    const layout = computeLayout(fixture)

    expect(layout.get('f1')).toEqual({ x: 0, y: 0, width: 390, height: 844 })
    expect(layout.get('e1')).toEqual({ x: 48, y: 88, width: 72, height: 72 })
  })

  it('stacks a vertical layout with gap and padding', () => {
    const doc = document([
      {
        id: 'f',
        type: 'frame',
        x: 0,
        y: 0,
        width: 100,
        height: 'fit_content(10)',
        layout: 'vertical',
        gap: 10,
        padding: 5,
        children: [box('a'), box('b')],
      },
    ])

    const layout = computeLayout(doc)

    expect(layout.get('a')).toEqual({ x: 5, y: 5, width: 40, height: 20 })
    expect(layout.get('b')).toEqual({ x: 5, y: 35, width: 40, height: 20 })
    expect(layout.get('f')?.height).toBe(60)
  })

  it('lays a horizontal row out with space_between and centred cross axis', () => {
    const doc = document([
      {
        id: 'f',
        type: 'frame',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        layout: 'horizontal',
        justifyContent: 'space_between',
        alignItems: 'center',
        children: [box('a'), box('b')],
      },
    ])

    const layout = computeLayout(doc)

    expect(layout.get('a')).toEqual({ x: 0, y: 40, width: 40, height: 20 })
    expect(layout.get('b')).toEqual({ x: 160, y: 40, width: 40, height: 20 })
  })

  it('grows a fill_container child along the main axis', () => {
    const doc = document([
      {
        id: 'f',
        type: 'frame',
        x: 0,
        y: 0,
        width: 200,
        height: 50,
        layout: 'horizontal',
        children: [box('a'), box('b', { width: 'fill_container' })],
      },
    ])

    expect(computeLayout(doc).get('b')).toEqual({ x: 40, y: 0, width: 160, height: 20 })
  })

  it('stretches a fill_container child across the cross axis', () => {
    const doc = document([
      {
        id: 'f',
        type: 'frame',
        x: 0,
        y: 0,
        width: 200,
        height: 50,
        layout: 'vertical',
        children: [box('a', { width: 'fill_container' })],
      },
    ])

    expect(computeLayout(doc).get('a')?.width).toBe(200)
  })

  it('falls back when a behavior cannot resolve', () => {
    const doc = document([
      box('lonely', { width: 'fill_container(77)', height: 'fit_content(33)' }),
    ])

    expect(computeLayout(doc).get('lonely')).toEqual({ x: 0, y: 0, width: 77, height: 33 })
  })

  it('hugs content through nesting', () => {
    const doc = document([
      {
        id: 'outer',
        type: 'frame',
        x: 0,
        y: 0,
        width: 'fit_content(0)',
        height: 'fit_content(0)',
        layout: 'vertical',
        padding: 10,
        children: [
          {
            id: 'inner',
            type: 'frame',
            x: 0,
            y: 0,
            width: 'fit_content(0)',
            height: 'fit_content(0)',
            layout: 'horizontal',
            gap: 5,
            children: [box('a'), box('b')],
          },
        ],
      },
    ])

    const layout = computeLayout(doc)

    expect(layout.get('inner')).toEqual({ x: 10, y: 10, width: 85, height: 20 })
    expect(layout.get('outer')).toEqual({ x: 0, y: 0, width: 105, height: 40 })
  })
})
