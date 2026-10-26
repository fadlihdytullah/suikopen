import type { Variable } from '../../shared/schema/document'

type Palette = { bg: string; surface: string; text: string; muted: string; border: string; accent: string; 'accent-text': string }

export type DesignStyle = {
  name: string
  summary: string
  bestFor: string[]
  fonts: { heading: string; body: string; mono?: string }
  typeScale: { display: number; h1: number; h2: number; body: number; small: number }
  radius: number
  spacing: 'compact' | 'comfortable' | 'airy'
  notes: string[]
  light: Palette
  dark: Palette
}

export const STYLES: DesignStyle[] = [
  {
    name: 'Quiet SaaS',
    summary: 'Neutral greys, one calm blue, tight type. Gets out of the way of the content.',
    bestFor: ['web app', 'dashboard', 'settings', 'admin'],
    fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    typeScale: { display: 48, h1: 28, h2: 20, body: 14, small: 12 },
    radius: 8,
    spacing: 'compact',
    notes: ['Hairline 1px borders instead of shadows.', 'Accent only on primary buttons, links and the selected nav item.', 'Dense tables with 44px rows.'],
    light: { bg: '#ffffff', surface: '#f7f7f8', text: '#18181b', muted: '#71717a', border: '#e4e4e7', accent: '#2f6fed', 'accent-text': '#ffffff' },
    dark: { bg: '#0f0f11', surface: '#18181b', text: '#f4f4f5', muted: '#a1a1aa', border: '#27272a', accent: '#5b8cff', 'accent-text': '#ffffff' },
  },
  {
    name: 'Editorial Serif',
    summary: 'Magazine feel: large serif headlines on warm paper, generous margins.',
    bestFor: ['landing page', 'blog', 'portfolio', 'publication'],
    fonts: { heading: 'Fraunces', body: 'Source Serif 4' },
    typeScale: { display: 88, h1: 48, h2: 30, body: 18, small: 14 },
    radius: 2,
    spacing: 'airy',
    notes: ['Left-aligned text columns of 60-70 characters.', 'Thin rules to separate sections, no cards.', 'Large photography with captions in small caps.'],
    light: { bg: '#faf7f2', surface: '#f1ece3', text: '#1c1917', muted: '#6b625a', border: '#e2d9cc', accent: '#c2410c', 'accent-text': '#ffffff' },
    dark: { bg: '#161412', surface: '#211e1b', text: '#f3eee7', muted: '#a89f95', border: '#36302b', accent: '#f0773f', 'accent-text': '#161412' },
  },
  {
    name: 'Bold Startup',
    summary: 'Dark canvas, big grotesk type and a loud lime accent. Confident and fast.',
    bestFor: ['landing page', 'developer tool', 'launch', 'pitch slides'],
    fonts: { heading: 'Space Grotesk', body: 'Inter', mono: 'JetBrains Mono' },
    typeScale: { display: 96, h1: 56, h2: 32, body: 17, small: 13 },
    radius: 14,
    spacing: 'comfortable',
    notes: ['Headlines tight (line height 1.0-1.05, letter spacing -2).', 'Product screenshots on subtle glowing surfaces.', 'Accent reserved for the call to action and one highlight per section.'],
    light: { bg: '#f6f6f3', surface: '#ffffff', text: '#0b0b0f', muted: '#5c5c66', border: '#e2e2dc', accent: '#5b21b6', 'accent-text': '#ffffff' },
    dark: { bg: '#0b0b0f', surface: '#16161d', text: '#f5f5f7', muted: '#9a9aa6', border: '#26262f', accent: '#c6f432', 'accent-text': '#0b0b0f' },
  },
  {
    name: 'Soft Consumer',
    summary: 'Rounded, friendly and airy with a lavender accent. Feels approachable on phones.',
    bestFor: ['mobile app', 'consumer app', 'onboarding', 'wellness'],
    fonts: { heading: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans' },
    typeScale: { display: 40, h1: 30, h2: 20, body: 16, small: 13 },
    radius: 20,
    spacing: 'airy',
    notes: ['Large rounded surfaces with very soft shadows.', 'Full-width primary buttons, pill shaped.', 'Illustrative icons in the accent colour at low opacity backgrounds.'],
    light: { bg: '#fbfaff', surface: '#ffffff', text: '#1f1b2e', muted: '#6e6883', border: '#ebe7f5', accent: '#7c5cff', 'accent-text': '#ffffff' },
    dark: { bg: '#121019', surface: '#1c1926', text: '#f3f0ff', muted: '#a49dbd', border: '#2c2839', accent: '#9d85ff', 'accent-text': '#121019' },
  },
  {
    name: 'Swiss Grid',
    summary: 'Strict grid, black and white with a signal red. Typography does all the work.',
    bestFor: ['slides', 'portfolio', 'event', 'poster-like landing'],
    fonts: { heading: 'Inter Tight', body: 'Inter' },
    typeScale: { display: 120, h1: 64, h2: 36, body: 18, small: 13 },
    radius: 0,
    spacing: 'comfortable',
    notes: ['Flush-left everything on a 12-column grid.', 'Huge numbers and headlines, tiny labels in caps.', 'No shadows, no gradients; red only for one element per view.'],
    light: { bg: '#ffffff', surface: '#f2f2f2', text: '#000000', muted: '#5e5e5e', border: '#000000', accent: '#e10600', 'accent-text': '#ffffff' },
    dark: { bg: '#000000', surface: '#111111', text: '#ffffff', muted: '#a3a3a3', border: '#ffffff', accent: '#ff2a1f', 'accent-text': '#000000' },
  },
  {
    name: 'Technical Mono',
    summary: 'Slate surfaces, cyan accent and monospace details. Precise and engineered.',
    bestFor: ['developer tool', 'docs', 'dashboard', 'infrastructure product'],
    fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans', mono: 'IBM Plex Mono' },
    typeScale: { display: 64, h1: 36, h2: 22, body: 15, small: 12 },
    radius: 6,
    spacing: 'compact',
    notes: ['Mono for labels, numbers, code and keyboard hints.', 'Grid lines and dotted borders as texture.', 'Status colours (green, amber, red) carry meaning, never decoration.'],
    light: { bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', border: '#e2e8f0', accent: '#0891b2', 'accent-text': '#ffffff' },
    dark: { bg: '#0b1120', surface: '#111827', text: '#e2e8f0', muted: '#94a3b8', border: '#1e293b', accent: '#22d3ee', 'accent-text': '#0b1120' },
  },
  {
    name: 'Warm Friendly',
    summary: 'Cream background, round sans and an orange accent. Welcoming and human.',
    bestFor: ['education', 'community', 'food', 'small business'],
    fonts: { heading: 'Nunito', body: 'Nunito' },
    typeScale: { display: 64, h1: 40, h2: 26, body: 17, small: 14 },
    radius: 16,
    spacing: 'comfortable',
    notes: ['Photography of real people, warm tones.', 'Rounded buttons and chips, playful but not childish.', 'Secondary green for success and badges.'],
    light: { bg: '#fffaf0', surface: '#ffffff', text: '#2b2118', muted: '#7a6a5a', border: '#f0e4d0', accent: '#ea580c', 'accent-text': '#ffffff' },
    dark: { bg: '#1a140f', surface: '#251d16', text: '#fbf3e6', muted: '#bba893', border: '#3a2e23', accent: '#fb8a3c', 'accent-text': '#1a140f' },
  },
  {
    name: 'Luxury Minimal',
    summary: 'Ivory, charcoal and a touch of gold with a delicate serif. Slow and refined.',
    bestFor: ['fashion', 'hospitality', 'real estate', 'premium brand'],
    fonts: { heading: 'Cormorant Garamond', body: 'Manrope' },
    typeScale: { display: 96, h1: 56, h2: 32, body: 16, small: 12 },
    radius: 0,
    spacing: 'airy',
    notes: ['Lots of empty space; one image per view, edge to edge.', 'Small uppercase labels with wide letter spacing (2-3).', 'Thin outline buttons; gold only for hairlines and small details.'],
    light: { bg: '#f8f5ef', surface: '#ffffff', text: '#222222', muted: '#77716a', border: '#e6dfd3', accent: '#a07c3b', 'accent-text': '#ffffff' },
    dark: { bg: '#121110', surface: '#1b1a18', text: '#efe9df', muted: '#a39b8f', border: '#2e2b27', accent: '#c9a45c', 'accent-text': '#121110' },
  },
]

export function styleVariables(style: DesignStyle): Record<string, Variable> {
  const colors = Object.fromEntries(
    (Object.keys(style.light) as (keyof Palette)[]).map((key) => [
      key,
      { type: 'color', value: [{ value: style.light[key] }, { value: style.dark[key], theme: { mode: 'dark' } }] } satisfies Variable,
    ])
  )
  return {
    ...colors,
    radius: { type: 'number', value: style.radius },
  }
}

export function styleList() {
  return STYLES.map(({ name, summary, bestFor }) => ({ name, summary, bestFor }))
}

export function styleDetail(name: string) {
  const style = STYLES.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase())
  if (!style) {
    throw new Error(`No style named "${name}". Call get_style without a name for the list.`)
  }
  return {
    ...style,
    variables: styleVariables(style),
    howToApply:
      'Call set_variables with "variables" to add these tokens, then use "$bg", "$text", "$accent" and so on for fills and "$radius" for corners. Use the fonts by name in fontFamily. Light is the default; the dark values apply when the "mode" theme is "dark".',
  }
}
