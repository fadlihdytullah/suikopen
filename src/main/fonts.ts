import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type FontRequest = { family: string; weight?: number; italic?: boolean }
export type FontFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,63}$/
const FONT_LIMIT = 10 * 1024 * 1024
const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
}

const failedRemote = new Set<string>()

function snapWeight(weight: number): number {
  return Math.min(900, Math.max(100, Math.round(weight / 100) * 100))
}

export function localCandidates(family: string, weight: number, italic: boolean, home = homedir()): string[] {
  const bold = weight >= 600
  const suffix = bold && italic ? ' Bold Italic' : bold ? ' Bold' : italic ? ' Italic' : ''

  if (process.platform === 'win32') {
    return [`C:/Windows/Fonts/${family}${suffix}.ttf`]
  }
  if (process.platform !== 'darwin') {
    return []
  }

  const compact = family.replace(/ /g, '')
  const style = weight === 400 && italic ? 'Italic' : `${WEIGHT_NAMES[weight]}${italic ? 'Italic' : ''}`
  const userFiles = [join(home, 'Library/Fonts'), '/Library/Fonts'].flatMap((directory) =>
    ['otf', 'ttf'].flatMap((extension) => [`${directory}/${compact}-${style}.${extension}`, `${directory}/${family}${suffix}.${extension}`])
  )

  return [
    `/System/Library/Fonts/Supplemental/${family}${suffix}.ttf`,
    ...(suffix ? [] : [`/System/Library/Fonts/Supplemental/${family}.ttf`]),
    ...userFiles,
  ]
}

function fallbackCandidates(): string[] {
  if (process.platform === 'darwin') {
    return ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/SFNS.ttf']
  }
  if (process.platform === 'win32') {
    return ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf']
  }
  return ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function firstReadable(paths: string[]): Promise<ArrayBuffer | null> {
  for (const path of paths) {
    try {
      return toArrayBuffer(await readFile(path))
    } catch {
      continue
    }
  }
  return null
}

export function googleCssUrl(family: string, weight: number, italic: boolean): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${italic ? 1 : 0},${weight}`
}

export function fontFileUrl(css: string): string | null {
  return /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.(?:ttf|otf))\)/.exec(css)?.[1] ?? null
}

async function fetchGoogleFont(fetcher: FontFetch, family: string, weight: number, italic: boolean): Promise<Buffer | null> {
  const css = await fetcher(googleCssUrl(family, weight, italic), { headers: { 'User-Agent': 'suikopen' } })
  if (!css.ok) {
    return null
  }
  const url = fontFileUrl(await css.text())
  if (!url) {
    return null
  }
  const file = await fetcher(url)
  if (!file.ok) {
    return null
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  return bytes.byteLength > FONT_LIMIT ? null : bytes
}

async function googleFont(cacheDir: string, fetcher: FontFetch, family: string, weight: number, italic: boolean): Promise<ArrayBuffer | null> {
  const name = `${family.replace(/ /g, '_')}-${weight}${italic ? '-italic' : ''}.ttf`
  const cached = join(cacheDir, name)

  try {
    return toArrayBuffer(await readFile(cached))
  } catch {
    if (failedRemote.has(name)) {
      return null
    }
  }

  try {
    const bytes = (await fetchGoogleFont(fetcher, family, weight, italic)) ?? (weight === 400 ? null : await fetchGoogleFont(fetcher, family, 400, italic))
    if (!bytes) {
      failedRemote.add(name)
      return null
    }
    await mkdir(cacheDir, { recursive: true })
    await writeFile(cached, bytes)
    return toArrayBuffer(bytes)
  } catch {
    return null
  }
}

export async function readFont(request: FontRequest, cacheDir: string, fetcher: FontFetch): Promise<ArrayBuffer | null> {
  const family = request.family.trim()
  const weight = snapWeight(request.weight ?? 400)
  const italic = request.italic ?? false

  if (FAMILY.test(family)) {
    const local = await firstReadable(localCandidates(family, weight, italic))
    if (local) {
      return local
    }
    const remote = await googleFont(cacheDir, fetcher, family, weight, italic)
    if (remote) {
      return remote
    }
  }

  return firstReadable(fallbackCandidates())
}
