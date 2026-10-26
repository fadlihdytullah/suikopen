import { describe, expect, it } from 'vitest'
import { importPen } from '../src/shared/pen-import'
import { resolveDocument } from '../src/renderer/document/resolve'

const pen = {
  version: '2.21',
  fileToken: 'x',
  themes: { mode: ['dark', 'light'] },
  variables: {
    ink: { type: 'color', value: [{ value: '#111111', theme: { mode: 'dark' } }, { value: '#eeeeee', theme: { mode: 'light' } }] },
    'space-2.5': { type: 'number', value: 10 },
  },
  children: [
    {
      type: 'frame',
      id: 'btn',
      reusable: true,
      x: 0,
      y: 0,
      gap: '$space-2.5',
      stroke: '$ink',
      strokeWidth: 2,
      strokeAlignment: 'outer',
      children: [
        { type: 'text', id: 'label', content: 'Go', fontWeight: 'bold', fill: '$ink' },
        { type: 'icon', id: 'arrow', icon: 'arrow-right', library: 'lucide', width: 16, height: 16, fill: '$ink' },
        { type: 'rectangle', id: 'hidden', enabled: false, width: 1, height: 1 },
      ],
    },
    { type: 'ref', id: 'b2', ref: 'btn', x: 100, y: 0, fill: '#ff0000', descendants: { label: { content: 'Next' } } },
    { type: 'ref', id: 'b3', ref: 'elsewhere', x: 200, y: 0 },
  ],
}

describe('importPen', () => {
  const document = importPen(pen)
  const [frame, ref, missing] = document.children

  it('maps frame defaults, strokes and dotted variable refs', () => {
    expect(frame).toMatchObject({
      type: 'frame',
      layout: 'horizontal',
      width: 'fit_content',
      gap: 10,
      stroke: { color: '$ink', width: 2, align: 'outside' },
    })
    expect(document.themes).toEqual({ mode: ['dark', 'light'] })
    expect(document.variables?.ink?.type).toBe('color')
  })

  it('maps text, replaces unsupported nodes and hides disabled ones', () => {
    const children = frame?.type === 'frame' ? frame.children : []
    expect(children.map((child) => child.type)).toEqual(['text', 'rectangle', 'rectangle'])
    expect(children[2]).toMatchObject({ visible: false })
    expect(children[0]).toMatchObject({ fontWeight: 700, width: 'fit_content', height: 'fit_content' })
    expect(children[1]).toMatchObject({ width: 16, height: 16 })
    expect(children[1]).not.toHaveProperty('fill')
  })

  it('turns refs into instances with overrides and stubs missing masters', () => {
    expect(ref).toMatchObject({ type: 'ref', masterId: 'btn', overrides: { btn: { fill: '#ff0000' }, 'btn/label': { content: 'Next' } } })
    expect(missing?.type).toBe('rectangle')
    const resolved = resolveDocument(document, { mode: 'light' })
    expect(resolved.error).toBeNull()
    const instance = resolved.document.children[1]
    expect(instance?.type === 'frame' && instance.children[0]).toMatchObject({ content: 'Next', fill: '#eeeeee' })
  })

  it('rejects non-pen input', () => {
    expect(() => importPen({ version: 1 })).toThrow('Not a .pen document')
  })
})
