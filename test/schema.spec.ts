import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DocumentParseError, parseDocument } from '../src/shared/schema/document'
import { buildIndex } from '../src/shared/document/index-tree'
import { hasChildren } from '../src/shared/schema/node'

const fixture = JSON.parse(readFileSync(new URL('../fixtures/hello.spen', import.meta.url), 'utf8'))

function withFixture(mutate: (doc: Record<string, any>) => void): unknown {
  const copy = structuredClone(fixture)
  mutate(copy)
  return copy
}

describe('parseDocument', () => {
  it('parses the fixture into a typed tree', () => {
    const document = parseDocument(fixture)

    expect(document.version).toBe(1)
    const frame = document.children[0]
    expect(frame?.type).toBe('frame')
    expect(frame && hasChildren(frame) ? frame.children.map((child) => child.id) : []).toEqual(['r1', 'e1', 't1'])
  })

  it('rejects a document with no version', () => {
    expect(() => parseDocument(withFixture((doc) => delete doc['version']))).toThrow(/no version field/)
  })

  it('separates an unsupported version from a malformed document', () => {
    expect(() => parseDocument(withFixture((doc) => (doc['version'] = 99)))).toThrow(/Unsupported document version 99/)
  })

  it('names the path of a bad field', () => {
    const broken = withFixture((doc) => (doc['children'][0].children[0].width = '342'))

    try {
      parseDocument(broken)
      expect.unreachable('expected a parse failure')
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentParseError)
      expect((error as DocumentParseError).issues[0]?.path).toBe('children[0].children[0].width')
    }
  })

  it('rejects an unknown node type', () => {
    expect(() => parseDocument(withFixture((doc) => (doc['children'][0].children[0].type = 'hologram')))).toThrow(
      DocumentParseError
    )
  })

  it('rejects a colour that is neither hex nor a variable reference', () => {
    try {
      parseDocument(withFixture((doc) => (doc['children'][0].fill = 'white')))
      expect.unreachable('expected a parse failure')
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentParseError)
      expect((error as DocumentParseError).issues.some((issue) => issue.path.startsWith('children[0].fill'))).toBe(true)
    }
  })

  it('accepts a variable reference where a colour is expected', () => {
    expect(() => parseDocument(withFixture((doc) => (doc['children'][0].fill = '$accent')))).not.toThrow()
  })
})

describe('buildIndex', () => {
  it('indexes every node with its parent', () => {
    const index = buildIndex(
      parseDocument({
        version: 1,
        children: [
          {
            id: 'f1',
            type: 'frame',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            children: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }],
          },
        ],
      })
    )

    expect([...index.keys()]).toEqual(['f1', 'r1'])
    expect(index.get('f1')?.parent).toBeNull()
    expect(index.get('r1')?.parent?.id).toBe('f1')
  })

  it('rejects a duplicate id', () => {
    const document = parseDocument(withFixture((doc) => (doc['children'][0].children[1].id = 'r1')))

    expect(() => buildIndex(document)).toThrow(/Duplicate node id "r1"/)
  })
})
