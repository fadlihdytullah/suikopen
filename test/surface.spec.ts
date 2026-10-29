import { describe, expect, it, vi } from 'vitest'
import type { CanvasKit, Surface } from 'canvaskit-wasm'
import { createCanvasKitLoader, type CanvasKitInitializer } from '../src/renderer/canvas/canvaskit'
import { applyCanvasSize, wrapSurface, type SizedCanvas } from '../src/renderer/canvas/surface'

function fakeCanvas(): SizedCanvas {
  return { width: 0, height: 0, style: { width: '', height: '' } }
}

describe('applyCanvasSize', () => {
  it.each([1, 2, 2.5])('sets the backing store to css size times dpr at %s', (dpr) => {
    const canvas = fakeCanvas()

    applyCanvasSize(canvas, 800, 600, dpr)

    expect(canvas.width).toBe(Math.round(800 * dpr))
    expect(canvas.height).toBe(Math.round(600 * dpr))
    expect(canvas.style.width).toBe('800px')
    expect(canvas.style.height).toBe('600px')
  })

  it('never produces a zero-sized backing store', () => {
    const canvas = fakeCanvas()

    applyCanvasSize(canvas, 0, 0, 2)

    expect(canvas.width).toBe(1)
    expect(canvas.height).toBe(1)
  })
})

describe('wrapSurface', () => {
  it('disposes the surface and its GPU context exactly once however often dispose is called', () => {
    const remove = vi.fn()
    const handle = wrapSurface({ dispose: remove } as unknown as Surface, 800, 600, 2)

    handle.dispose()
    handle.dispose()
    handle.dispose()

    expect(remove).toHaveBeenCalledTimes(1)
  })
})

describe('createCanvasKitLoader', () => {
  it('initializes the module once under concurrent callers', async () => {
    const init = vi.fn<CanvasKitInitializer>(async () => ({}) as CanvasKit)
    const load = createCanvasKitLoader(init, '/assets/canvaskit.wasm')

    const results = await Promise.all([load(), load(), load()])

    expect(init).toHaveBeenCalledTimes(1)
    expect(new Set(results).size).toBe(1)
  })

  it('locates the wasm through the bundler-resolved url', async () => {
    const init = vi.fn<CanvasKitInitializer>(async () => ({}) as CanvasKit)

    await createCanvasKitLoader(init, '/assets/canvaskit-abc123.wasm')()

    expect(init.mock.calls[0]?.[0]?.locateFile('canvaskit.wasm')).toBe('/assets/canvaskit-abc123.wasm')
  })
})

describe('snapshotScale', async () => {
  const { snapshotScale, SNAPSHOT_MAX_PIXELS, SNAPSHOT_MAX_SIDE } = await import('../src/renderer/canvas/paint')

  it('keeps small frames at 2x and caps huge ones', () => {
    expect(snapshotScale(400, 300)).toBe(2)
    const wide = snapshotScale(12000, 4000)
    expect(12000 * wide).toBeLessThanOrEqual(SNAPSHOT_MAX_SIDE)
    const big = snapshotScale(3000, 3000)
    expect(3000 * big * 3000 * big).toBeLessThanOrEqual(SNAPSHOT_MAX_PIXELS + 1)
  })
})
