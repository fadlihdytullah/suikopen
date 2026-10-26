import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocument, type Document } from '../src/shared/schema/document'
import { createDocumentStore } from '../src/renderer/store/document-store'
import { createHistory } from '../src/renderer/store/history'

function fixture(): Document {
  return parseDocument(JSON.parse(readFileSync(new URL('../fixtures/hello.spen', import.meta.url), 'utf8')))
}

function card(document: Document) {
  const frame = document.children[0]
  if (!frame || frame.type !== 'frame') {
    throw new Error('fixture changed')
  }
  return frame.children[0]!
}

describe('createDocumentStore', () => {
  it('shares untouched subtrees and replaces only the path to the change', () => {
    const store = createDocumentStore(fixture())
    const before = store.getState()

    store.apply('Move card', (draft) => {
      const frame = draft.children[0]!
      if (frame.type === 'frame') {
        frame.children[0]!.x += 10
      }
    })

    const after = store.getState()
    const beforeFrame = before.children[0]!
    const afterFrame = after.children[0]!

    expect(after).not.toBe(before)
    expect(afterFrame).not.toBe(beforeFrame)
    expect(card(after)).not.toBe(card(before))
    if (beforeFrame.type === 'frame' && afterFrame.type === 'frame') {
      expect(afterFrame.children[1]).toBe(beforeFrame.children[1])
      expect(afterFrame.children[2]).toBe(beforeFrame.children[2])
    }
  })

  it('restores exact state through undo and redo across several edits', () => {
    const store = createDocumentStore(fixture())
    const original = structuredClone(store.getState())

    store.apply('Move', (draft) => void ((draft.children[0] as any).children[0].x = 100))
    store.apply('Resize', (draft) => void ((draft.children[0] as any).children[0].width = 10))
    store.apply('Recolour', (draft) => void ((draft.children[0] as any).fill = '#000000'))
    const edited = structuredClone(store.getState())

    store.undo()
    store.undo()
    store.undo()
    expect(store.getState()).toEqual(original)
    expect(store.canUndo()).toBe(false)

    store.redo()
    store.redo()
    store.redo()
    expect(store.getState()).toEqual(edited)
    expect(store.canRedo()).toBe(false)
  })

  it('collapses a 200-step drag into one undo', () => {
    const store = createDocumentStore(fixture())
    const original = structuredClone(store.getState())

    store.beginGesture('Move card')
    for (let step = 0; step < 200; step += 1) {
      store.apply(null, (draft) => void ((draft.children[0] as any).children[0].x += 1))
    }
    store.endGesture()

    expect(store.history.depth().past).toBe(1)
    expect((store.getState().children[0] as any).children[0].x).toBe(224)

    store.undo()
    expect(store.getState()).toEqual(original)
  })

  it('closes an abandoned gesture when the next one opens', () => {
    const store = createDocumentStore(fixture())

    store.beginGesture('First')
    store.apply(null, (draft) => void ((draft.children[0] as any).children[0].x += 5))
    store.beginGesture('Second')
    store.apply(null, (draft) => void ((draft.children[0] as any).children[0].y += 5))
    store.endGesture()

    expect(store.history.depth().past).toBe(2)
    expect(store.history.isOpen()).toBe(false)
  })

  it('drops the redo stack on a new edit', () => {
    const store = createDocumentStore(fixture())

    store.apply('A', (draft) => void ((draft.children[0] as any).children[0].x = 1))
    store.undo()
    expect(store.canRedo()).toBe(true)

    store.apply('B', (draft) => void ((draft.children[0] as any).children[0].y = 2))
    expect(store.canRedo()).toBe(false)
  })

  it('ignores a recipe that changes nothing', () => {
    const store = createDocumentStore(fixture())
    let notified = 0
    store.subscribe(() => (notified += 1))

    store.apply('No-op', (draft) => void draft.children.length)

    expect(notified).toBe(0)
    expect(store.canUndo()).toBe(false)
  })

  it('notifies subscribers once per applied edit', () => {
    const store = createDocumentStore(fixture())
    let notified = 0
    store.subscribe(() => (notified += 1))

    store.apply('Move', (draft) => void ((draft.children[0] as any).children[0].x = 7))
    store.undo()
    store.redo()

    expect(notified).toBe(3)
  })
})

describe('createHistory', () => {
  it('drops the oldest entry past the limit', () => {
    const history = createHistory(3)

    for (let i = 0; i < 5; i += 1) {
      history.push({ label: `edit ${i}`, forward: [{ op: 'replace', path: ['x'], value: i }], inverse: [] })
    }

    expect(history.depth().past).toBe(3)
    expect(history.undo()?.label).toBe('edit 4')
  })

  it('pushes nothing for an empty gesture', () => {
    const history = createHistory()

    history.open('Empty')
    history.close()

    expect(history.depth().past).toBe(0)
    expect(history.isOpen()).toBe(false)
  })
})
