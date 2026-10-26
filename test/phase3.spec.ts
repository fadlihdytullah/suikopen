import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fontFileUrl, googleCssUrl, readFont } from '../src/main/fonts'
import { findIcons, iconUrl } from '../src/main/mcp/icons'
import { STYLES, styleDetail, styleList } from '../src/main/agent/styles'
import { parseDocument, VariableSchema } from '../src/shared/schema/document'
import { createDocumentStore } from '../src/renderer/store/document-store'
import { createMutationQueue } from '../src/renderer/store/mutation-queue'
import { createSelectionStore } from '../src/renderer/store/selection'
import { createAgentHandlers } from '../src/renderer/mcp/handlers'

const CSS = "@font-face { src: url(https://fonts.gstatic.com/s/inter/v20/abc.ttf) format('truetype'); }"

function fakeFetch(css = CSS, cssStatus = 200) {
  return vi.fn(async (url: string) =>
    url.startsWith('https://fonts.googleapis.com')
      ? new Response(css, { status: cssStatus })
      : new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
  )
}

describe('fonts', () => {
  it('builds the Google Fonts css url and finds the font file in it', () => {
    expect(googleCssUrl('Space Grotesk', 700, false)).toBe('https://fonts.googleapis.com/css2?family=Space+Grotesk:ital,wght@0,700')
    expect(fontFileUrl(CSS)).toBe('https://fonts.gstatic.com/s/inter/v20/abc.ttf')
    expect(fontFileUrl('src: url(https://evil.example/x.ttf)')).toBeNull()
  })

  it('downloads a missing family once and serves it from the cache after', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'fonts-'))
    const fetcher = fakeFetch()

    const first = await readFont({ family: 'Zzq Test Sans', weight: 640 }, cache, fetcher)
    const second = await readFont({ family: 'Zzq Test Sans', weight: 600 }, cache, fetcher)

    expect(new Uint8Array(first!)).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(new Uint8Array(second!)).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await readdir(cache)).toEqual(['Zzq_Test_Sans-600.ttf'])
  })

  it('never sends an unsafe family name anywhere', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'fonts-'))
    const fetcher = fakeFetch()
    await readFont({ family: '../../etc/passwd' }, cache, fetcher)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('icons', () => {
  it('returns names with ready urls', async () => {
    const fetcher = vi.fn(async (_url: string) => Response.json({ icons: ['lucide:bell', 'lucide:bell-off'] }))
    const icons = await findIcons(fetcher, 'bell', 'lucide', 1)

    expect(fetcher.mock.calls[0]?.[0]).toContain('query=bell&prefix=lucide')
    expect(icons).toEqual([{ name: 'lucide:bell', url: 'https://api.iconify.design/lucide/bell.svg?color=%23111111' }])
    expect(iconUrl('ph:house', '#ffffff')).toBe('https://api.iconify.design/ph/house.svg?color=%23ffffff')
  })
})

describe('styles', () => {
  it('lists every style and gives valid tokens for each', () => {
    expect(styleList()).toHaveLength(STYLES.length)
    for (const style of STYLES) {
      const detail = styleDetail(style.name.toUpperCase())
      for (const variable of Object.values(detail.variables)) {
        expect(VariableSchema.safeParse(variable).success).toBe(true)
      }
      expect(Object.keys(detail.variables)).toEqual(expect.arrayContaining(['bg', 'text', 'accent', 'radius']))
    }
    expect(() => styleDetail('Nope')).toThrow(/No style named/)
  })
})

describe('set_variables', () => {
  function harness() {
    const store = createDocumentStore(parseDocument({ version: 1, variables: { old: { type: 'number', value: 1 } }, children: [] }))
    const handle = createAgentHandlers({ store, selection: createSelectionStore(), queue: createMutationQueue(store), documentPath: () => null })
    return { store, call: (params: Record<string, unknown>) => handle({ id: 'v', method: 'set_variables', params }) }
  }

  it('merges tokens and declares theme axes', async () => {
    const { store, call } = harness()
    await call({ variables: styleDetail('Quiet SaaS').variables })

    expect(Object.keys(store.getState().variables ?? {})).toEqual(expect.arrayContaining(['old', 'bg', 'accent']))
    expect(store.getState().themes).toEqual({ mode: ['dark'] })
  })

  it('rejects an invalid token without changing anything', async () => {
    const { store, call } = harness()
    const before = store.getState()
    await expect(call({ variables: { bad: { type: 'color', value: 'red' } } })).rejects.toThrow(/Invalid variable "bad"/)
    expect(store.getState()).toBe(before)
  })
})
