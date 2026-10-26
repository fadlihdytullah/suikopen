import { describe, expect, it } from 'vitest'
import { parseDocument, type Document } from '../src/shared/schema/document'
import { resolveDocument } from '../src/renderer/document/resolve'

function document(extra: Record<string, unknown>, children: unknown[]): Document {
  return parseDocument({ version: 1, ...extra, children })
}

const box = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...extra,
})

describe('variables', () => {
  const variables = {
    accent: { type: 'color', value: '#2f6fed' },
    radius: { type: 'number', value: 8 },
    surface: {
      type: 'color',
      value: [
        { value: '#ffffff', theme: { appearance: 'light' } },
        { value: '#000000', theme: { appearance: 'dark' } },
      ],
    },
  }

  it('substitutes a plain variable everywhere it appears', () => {
    const doc = document({ variables }, [box('a', { fill: '$accent', cornerRadius: '$radius' })])

    const node = resolveDocument(doc).document.children[0]!

    expect(node.fill).toBe('#2f6fed')
    expect(node.type === 'rectangle' && node.cornerRadius).toBe(8)
  })

  it('picks the value for the active theme', () => {
    const doc = document({ themes: { appearance: ['light', 'dark'] }, variables }, [box('a', { fill: '$surface' })])

    expect(resolveDocument(doc, { appearance: 'light' }).document.children[0]?.fill).toBe('#ffffff')
    expect(resolveDocument(doc, { appearance: 'dark' }).document.children[0]?.fill).toBe('#000000')
  })

  it('falls back to the first value when no theme is active', () => {
    const doc = document({ themes: { appearance: ['light', 'dark'] }, variables }, [box('a', { fill: '$surface' })])

    expect(resolveDocument(doc).document.children[0]?.fill).toBe('#ffffff')
  })

  it('leaves an unknown reference alone rather than crashing', () => {
    const doc = document({ variables }, [box('a', { fill: '$missing' })])

    expect(resolveDocument(doc).document.children[0]?.fill).toBe('$missing')
  })

  it('never substitutes an id', () => {
    const doc = document({ variables: { a: { type: 'string', value: 'nope' } } }, [box('$a')])

    expect(resolveDocument(doc).document.children[0]?.id).toBe('$a')
  })
})

describe('component instances', () => {
  const master = {
    id: 'master',
    type: 'frame',
    x: 500,
    y: 0,
    width: 100,
    height: 40,
    fill: '#2f6fed',
    layout: 'horizontal',
    children: [box('dot'), { ...box('label'), type: 'text', content: 'Button' }],
  }

  it('expands an instance into a copy of the master at the instance position', () => {
    const doc = document({}, [master, { id: 'i1', type: 'ref', x: 10, y: 20, width: 0, height: 0, masterId: 'master' }])

    const instance = resolveDocument(doc).document.children[1]!

    expect(instance.type).toBe('frame')
    expect({ x: instance.x, y: instance.y }).toEqual({ x: 10, y: 20 })
    expect(instance.type === 'frame' && instance.children.map((child) => child.id)).toEqual([
      'i1/dot',
      'i1/label',
    ])
  })

  it('applies overrides by master-relative path and leaves the master alone', () => {
    const doc = document({}, [
      master,
      {
        id: 'i1',
        type: 'ref',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        masterId: 'master',
        overrides: { master: { fill: '#3dd68c' }, 'master/label': { content: 'Changed' } },
      },
    ])

    const resolved = resolveDocument(doc).document
    const instance = resolved.children[1]!

    expect(instance.fill).toBe('#3dd68c')
    expect(instance.type === 'frame' && instance.children[1]).toMatchObject({ content: 'Changed' })
    expect(resolved.children[0]?.fill).toBe('#2f6fed')
  })

  it('propagates a master change to every instance', () => {
    const doc = document({}, [
      { ...master, fill: '#ff0000' },
      { id: 'i1', type: 'ref', x: 0, y: 0, width: 0, height: 0, masterId: 'master' },
      { id: 'i2', type: 'ref', x: 0, y: 60, width: 0, height: 0, masterId: 'master' },
    ])

    const resolved = resolveDocument(doc).document

    expect(resolved.children[1]?.fill).toBe('#ff0000')
    expect(resolved.children[2]?.fill).toBe('#ff0000')
  })

  it('reports a missing master instead of dropping the node', () => {
    const doc = document({}, [{ id: 'i1', type: 'ref', x: 0, y: 0, width: 0, height: 0, masterId: 'gone' }])

    expect(resolveDocument(doc).error).toMatch(/missing master "gone"/)
  })

  it('refuses a component that contains itself', () => {
    const doc = document({}, [
      {
        id: 'master',
        type: 'frame',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        children: [{ id: 'inner', type: 'ref', x: 0, y: 0, width: 0, height: 0, masterId: 'master' }],
      },
      { id: 'i1', type: 'ref', x: 0, y: 0, width: 0, height: 0, masterId: 'master' },
    ])

    expect(resolveDocument(doc).error).toMatch(/contains itself/)
  })

  it('resolves variables inside an expanded instance', () => {
    const doc = document({ variables: { accent: { type: 'color', value: '#123456' } } }, [
      { ...master, fill: '$accent' },
      { id: 'i1', type: 'ref', x: 0, y: 0, width: 0, height: 0, masterId: 'master' },
    ])

    expect(resolveDocument(doc).document.children[1]?.fill).toBe('#123456')
  })
})
