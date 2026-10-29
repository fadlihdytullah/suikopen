import type { CanvasKit, Image } from 'canvaskit-wasm'

const SVG_RASTER_SIZE = 512
export const IMAGE_BUDGET_BYTES = 256 * 1024 * 1024

type Entry = { image: Image | null; pending: boolean; bytes: number }

export function createLru<T extends { bytes: number }>(budget: number, dispose: (entry: T) => void) {
  const entries = new Map<string, T>()
  let total = 0

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key)
      if (entry) {
        entries.delete(key)
        entries.set(key, entry)
      }
      return entry
    },
    set(key: string, entry: T): void {
      entries.set(key, entry)
    },
    grow(key: string, bytes: number): void {
      const entry = entries.get(key)
      if (!entry) {
        return
      }
      total += bytes - entry.bytes
      entry.bytes = bytes
      for (const [other, value] of entries) {
        if (total <= budget) {
          break
        }
        if (other === key || value.bytes === 0) {
          continue
        }
        entries.delete(other)
        total -= value.bytes
        dispose(value)
      }
    },
    total: (): number => total,
    keys: (): string[] => [...entries.keys()],
  }
}

const cache = createLru<Entry>(IMAGE_BUDGET_BYTES, (entry) => {
  entry.image?.delete()
  entry.image = null
})
let base: string | null = null
let onLoaded: () => void = () => {}

export function setAssetBase(path: string | null): void {
  base = path
}

export function imageKey(assetBase: string | null, url: string): string {
  return /^(https?:|data:)/i.test(url) ? url : `${assetBase ?? ''}|${url}`
}

export function onImageLoaded(callback: () => void): void {
  onLoaded = callback
}

async function rasterizeSvg(bytes: ArrayBuffer): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }))

  try {
    const element = new Image()
    element.src = url
    await element.decode()

    const ratio = element.naturalWidth > 0 && element.naturalHeight > 0 ? element.naturalHeight / element.naturalWidth : 1
    const width = ratio <= 1 ? SVG_RASTER_SIZE : Math.round(SVG_RASTER_SIZE / ratio)
    const height = ratio <= 1 ? Math.round(SVG_RASTER_SIZE * ratio) : SVG_RASTER_SIZE

    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }
    context.drawImage(element, 0, 0, width, height)

    const png = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await png.arrayBuffer())
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function getImage(canvasKit: CanvasKit, url: string): Image | null {
  const key = imageKey(base, url)
  const cached = cache.get(key)
  if (cached) {
    return cached.image
  }

  const entry: Entry = { image: null, pending: true, bytes: 0 }
  cache.set(key, entry)

  window.suikopen
    .readAsset({ base, url })
    .then(async (asset) => {
      entry.pending = false
      if (!asset) {
        return
      }
      const encoded = asset.type.includes('svg') ? await rasterizeSvg(asset.bytes) : new Uint8Array(asset.bytes)
      if (!encoded) {
        return
      }
      entry.image = canvasKit.MakeImageFromEncoded(encoded)
      if (entry.image) {
        cache.grow(key, entry.image.width() * entry.image.height() * 4)
      }
      onLoaded()
    })
    .catch(() => {
      entry.pending = false
    })

  return null
}
