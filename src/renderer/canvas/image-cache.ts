import type { CanvasKit, Image } from 'canvaskit-wasm'

const SVG_RASTER_SIZE = 512

type Entry = { image: Image | null; pending: boolean }

const cache = new Map<string, Entry>()
let base: string | null = null
let onLoaded: () => void = () => {}

export function setAssetBase(path: string | null): void {
  base = path
  cache.clear()
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
  const cached = cache.get(url)
  if (cached) {
    return cached.image
  }

  const entry: Entry = { image: null, pending: true }
  cache.set(url, entry)

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
      onLoaded()
    })
    .catch(() => {
      entry.pending = false
    })

  return null
}
