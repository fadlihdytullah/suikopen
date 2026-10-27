export const IMAGE_HOSTS = [
  'api.iconify.design',
  'cdn.simpleicons.org',
  'images.unsplash.com',
  'plus.unsplash.com',
  'images.pexels.com',
  'upload.wikimedia.org',
  'raw.githubusercontent.com',
  'avatars.githubusercontent.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
]

export function allowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && IMAGE_HOSTS.includes(parsed.hostname)
  } catch {
    return false
  }
}
