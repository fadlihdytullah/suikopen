import { createPresence } from '../src/renderer/agent/presence'
import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/shared/schema/document'
import { createDocumentStore } from '../src/renderer/store/document-store'
import { createMutationQueue } from '../src/renderer/store/mutation-queue'
import { createSelectionStore } from '../src/renderer/store/selection'
import { createAgentHandlers } from '../src/renderer/mcp/handlers'
import { variablesCss } from '../src/renderer/mcp/html-export'

function harness() {
  const store = createDocumentStore(
    parseDocument({
      version: 1,
      variables: {
        accent: { type: 'color', value: [{ value: '#2f6fed' }, { value: '#7aa2ff', theme: { mode: 'dark' } }] },
        space: { type: 'number', value: 16 },
      },
      children: [
        {
          id: 'screen',
          type: 'frame',
          name: 'Screen',
          x: 0,
          y: 0,
          width: 400,
          height: 'fit_content(300)',
          layout: 'vertical',
          gap: '$space',
          padding: [24, 32],
          fill: '#ffffff',
          children: [
            { id: 'title', type: 'text', name: 'Title', x: 0, y: 0, width: 'fill_container', height: 'fit_content(24)', content: 'Hello <world>', fontSize: 24, fontWeight: 600, fill: '#111111' },
            {
              id: 'cta',
              type: 'frame',
              name: 'Button',
              x: 0,
              y: 0,
              width: 'fit_content',
              height: 40,
              layout: 'horizontal',
              alignItems: 'center',
              padding: [0, 16],
              cornerRadius: 8,
              fill: '$accent',
              children: [{ id: 'cta-label', type: 'text', name: 'Label', x: 0, y: 0, width: 'fit_content', height: 'fit_content', content: 'Start', fill: '#ffffff' }],
            },
          ],
        },
      ],
    })
  )
  const handle = createAgentHandlers({
    store,
    selection: createSelectionStore(),
    queue: createMutationQueue(store),
    presence: createPresence(), documentPath: () => null,
  })
  const call = (method: string, params: Record<string, unknown> = {}) => handle({ id: method, method, params })
  return { store, call }
}

const row = (id: string) => ({ tool: 'create_node', parentId: 'screen', node: { id, type: 'rectangle', x: 0, y: 0, width: 100, height: 20 } })

describe('batch', () => {
  it('applies every op as one undo step, with later ops using earlier ids', async () => {
    const { store, call } = harness()
    const result = (await call('batch', {
      ops: [row('a'), { tool: 'update_node', id: 'a', props: { width: 120 } }, { tool: 'set_text', id: 'title', content: 'Hi' }],
    })) as { results: unknown[] }

    expect(result.results).toHaveLength(3)
    expect(JSON.stringify(store.getState())).toContain('"content":"Hi"')
    store.undo()
    expect(JSON.stringify(store.getState())).not.toContain('"id":"a"')
    expect(JSON.stringify(store.getState())).toContain('Hello <world>')
  })

  it('applies nothing when one op fails', async () => {
    const { store, call } = harness()
    const before = store.getState()

    await expect(call('batch', { ops: [row('a'), { tool: 'set_text', id: 'cta', content: 'x' }] })).rejects.toThrow(/Operation 2 \(set_text\) failed.*Nothing in this batch was applied/)
    expect(JSON.stringify(store.getState())).toBe(JSON.stringify(before))
    expect(store.canRedo()).toBe(true)
  })

  it('refuses unknown tools', async () => {
    const { call } = harness()
    await expect(call('batch', { ops: [{ tool: 'export_code' }] })).rejects.toThrow(/must be one of/)
  })

  it('reports layout problems once for the touched screen', async () => {
    const { call } = harness()
    const result = (await call('batch', {
      ops: [{ tool: 'create_node', parentId: 'screen', node: { id: 'wide', type: 'rectangle', x: 0, y: 0, width: 900, height: 20 } }],
    })) as { problems?: { id: string }[] }

    expect(result.problems?.map((problem) => problem.id)).toContain('wide')
  })
})

describe('export_code', () => {
  it('produces Tailwind HTML with tokens kept as CSS variables', async () => {
    const { call } = harness()
    const { html, css, fonts, images } = (await call('export_code', { id: 'screen' })) as { html: string; css: string; fonts: string[]; images: string[] }

    expect(html).toContain('flex flex-col')
    expect(html).toContain('gap-[calc(var(--space)_*_1px)]')
    expect(html).toContain('p-[24px_32px]')
    expect(html).toContain('bg-[var(--accent)]')
    expect(html).toContain('self-stretch')
    expect(html).toContain('Hello &lt;world&gt;')
    expect(html).toContain('data-name="Button"')
    expect(css).toContain('--accent: #2f6fed;')
    expect(css).toContain('[data-mode="dark"]')
    expect(fonts).toEqual([])
    expect(images).toEqual([])
  })

  it('produces class names and a stylesheet for html-css', async () => {
    const { call } = harness()
    const { html, css } = (await call('export_code', { id: 'cta', format: 'html-css' })) as { html: string; css: string }

    expect(html).toContain('<div class="button"')
    expect(html).toContain('<p class="label"')
    expect(css).toContain('.button {')
    expect(css).toContain('border-radius: 8px;')
    expect(css).toContain('* { box-sizing: border-box; }')
  })

  it('renders variables as CSS custom properties', () => {
    expect(variablesCss({ brand: { type: 'color', value: '#000000' } })).toBe(':root {\n  --brand: #000000;\n}')
  })
})
