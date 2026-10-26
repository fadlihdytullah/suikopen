import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/shared/schema/document'
import { cornerRadii, toArray } from '../src/shared/schema/node'
import { parseHexColor } from '../src/renderer/canvas/color'

describe('schema styling', () => {
  it('accepts a hex string, a solid fill object and a list of fills', () => {
    const document = parseDocument({
      version: 1,
      children: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, fill: '#fff' },
        { id: 'b', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, fill: { type: 'color', color: '#112233' } },
        {
          id: 'c',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          fill: [
            '#000000',
            { type: 'gradient', colors: [{ color: '#fff', position: 0 }, { color: '#000', position: 1 }] },
          ],
        },
      ],
    })

    expect(toArray(document.children[2]?.fill).length).toBe(2)
  })

  it('rejects a gradient with a single stop', () => {
    expect(() =>
      parseDocument({
        version: 1,
        children: [
          {
            id: 'a',
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            fill: { type: 'gradient', colors: [{ color: '#fff', position: 0 }] },
          },
        ],
      })
    ).toThrow()
  })

  it('accepts stroke, effects and per-corner radius', () => {
    const document = parseDocument({
      version: 1,
      children: [
        {
          id: 'a',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          cornerRadius: [1, 2, 3, 4],
          stroke: { color: '#ff0000', width: 2, align: 'outside' },
          effect: [
            { type: 'shadow', shadowType: 'inner', blur: 4 },
            { type: 'blur', radius: 8 },
          ],
        },
      ],
    })

    const node = document.children[0]!
    expect(node.type === 'rectangle' && cornerRadii(node.cornerRadius)).toEqual([1, 2, 3, 4])
    expect(toArray(node.effect).length).toBe(2)
    expect(node.stroke?.align).toBe('outside')
  })

  it('rejects an unknown effect type', () => {
    expect(() =>
      parseDocument({
        version: 1,
        children: [
          { id: 'a', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, effect: { type: 'glow', radius: 2 } },
        ],
      })
    ).toThrow()
  })

  it('accepts text styling', () => {
    const document = parseDocument({
      version: 1,
      children: [
        {
          id: 't',
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          height: 'fit_content(20)',
          content: 'hi',
          fontFamily: 'Georgia',
          fontWeight: 700,
          fontStyle: 'italic',
          letterSpacing: 1.5,
          lineHeight: 1.4,
          textAlign: 'center',
        },
      ],
    })

    const node = document.children[0]!
    expect(node.type === 'text' && node.fontWeight).toBe(700)
  })

  it('rejects a font weight outside the usable range', () => {
    expect(() =>
      parseDocument({
        version: 1,
        children: [{ id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1, content: 'x', fontWeight: 1000 }],
      })
    ).toThrow()
  })
})

describe('cornerRadii', () => {
  it('expands a single radius and passes a tuple through', () => {
    expect(cornerRadii(6)).toEqual([6, 6, 6, 6])
    expect(cornerRadii([1, 2, 3, 4])).toEqual([1, 2, 3, 4])
    expect(cornerRadii(undefined)).toEqual([0, 0, 0, 0])
  })
})

describe('parseHexColor', () => {
  it('reads short, long and alpha forms', () => {
    expect(parseHexColor('#fff')).toEqual([1, 1, 1, 1])
    expect(parseHexColor('#ff0000')).toEqual([1, 0, 0, 1])
    expect(parseHexColor('#00000080')[3]).toBeCloseTo(128 / 255, 5)
  })
})
