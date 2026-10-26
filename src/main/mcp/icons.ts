export type IconFetch = (url: string) => Promise<Response>

export const ICON_SETS = ['lucide', 'tabler', 'ph', 'mdi', 'simple-icons'] as const
export type IconSet = (typeof ICON_SETS)[number]

export function iconUrl(name: string, color = '#111111'): string {
  const [set, icon] = name.split(':')
  return `https://api.iconify.design/${set}/${icon}.svg?color=${encodeURIComponent(color)}`
}

export async function findIcons(fetcher: IconFetch, query: string, set: IconSet = 'lucide', limit = 12) {
  const url = `https://api.iconify.design/search?query=${encodeURIComponent(query)}&prefix=${set}&limit=${Math.max(limit, 32)}`
  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(`Icon search failed with HTTP ${response.status}.`)
  }
  const { icons = [] } = (await response.json()) as { icons?: string[] }
  return icons.slice(0, limit).map((name) => ({ name, url: iconUrl(name) }))
}
