import type { Variable } from '../../shared/schema/document'
import { hasChildren, toArray, type FillValue, type Node } from '../../shared/schema/node'
import type { Rect } from '../canvas/scene-index'
import { parseSizing } from '../layout/sizing'

export type ExportFormat = 'html-tailwind' | 'html-css'
export type ExportResult = { html: string; css: string; fonts: string[]; images: string[] }

type Declaration = [string, string]
type Layout = 'none' | 'vertical' | 'horizontal'

const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', space_between: 'space-between', space_around: 'space-around' }
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' }

function varName(reference: string): string {
  return `--${reference.slice(1)}`
}

function length(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('$')) {
    return `calc(var(${varName(value)}) * 1px)`
  }
  return `${Math.round((typeof value === 'number' ? value : 0) * 100) / 100}px`
}

function color(value: unknown, opacity = 1): string {
  const base = typeof value === 'string' && value.startsWith('$') ? `var(${varName(value)})` : String(value)
  return opacity < 1 ? `color-mix(in srgb, ${base} ${Math.round(opacity * 100)}%, transparent)` : base
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function background(fill: FillValue, images: Set<string>): { color?: string; layer?: string } | null {
  if (typeof fill === 'string') {
    return { color: color(fill) }
  }
  if (fill.enabled === false) {
    return null
  }
  if (fill.type === 'color') {
    return { color: color(fill.color, fill.opacity) }
  }
  if (fill.type === 'gradient') {
    const stops = fill.colors.map((stop) => `${color(stop.color)} ${Math.round(stop.position * 100)}%`).join(', ')
    if (fill.gradientType === 'radial') {
      return { layer: `radial-gradient(circle, ${stops})` }
    }
    if (fill.gradientType === 'angular') {
      return { layer: `conic-gradient(from ${(fill.rotation ?? 0) + 90}deg, ${stops})` }
    }
    return { layer: `linear-gradient(${180 + (fill.rotation ?? 0)}deg, ${stops})` }
  }
  images.add(fill.url)
  const size = fill.mode === 'contain' ? 'contain' : fill.mode === 'stretch' ? '100% 100%' : 'cover'
  return { layer: `url("${fill.url}") center / ${size} no-repeat` }
}

function onlyImage(node: Node): string | null {
  const fills = toArray(node.fill)
  const [fill] = fills
  return fills.length === 1 && fill && typeof fill === 'object' && fill.type === 'image' && fill.enabled !== false && node.type === 'rectangle'
    ? fill.url
    : null
}

function textColor(node: Node): string | null {
  for (const fill of [...toArray(node.fill)].reverse()) {
    if (typeof fill === 'string') {
      return color(fill)
    }
    if (fill.type === 'color' && fill.enabled !== false) {
      return color(fill.color, fill.opacity)
    }
  }
  return null
}

function boxStyles(node: Node, images: Set<string>, declarations: Declaration[]): void {
  if (node.type !== 'text' && !onlyImage(node)) {
    const layers = [...toArray(node.fill)].reverse().map((fill) => background(fill, images)).filter((entry) => entry !== null)
    const solids = layers.filter((entry) => entry.color)
    if (layers.length === 1 && solids.length === 1) {
      declarations.push(['background-color', solids[0]!.color!])
    } else if (layers.length > 0) {
      const values = layers.map((entry) => entry.layer ?? `linear-gradient(${entry.color}, ${entry.color})`)
      declarations.push(['background', values.join(', ')])
    }
  }

  if ('cornerRadius' in node && node.cornerRadius !== undefined) {
    const radius = node.cornerRadius
    declarations.push(['border-radius', Array.isArray(radius) ? radius.map(length).join(' ') : length(radius)])
  }
  if (node.type === 'ellipse') {
    declarations.push(['border-radius', '50%'])
  }

  if (node.stroke && node.stroke.enabled !== false && node.type !== 'text') {
    const value = `${px(node.stroke.width ?? 1)} solid ${color(node.stroke.color)}`
    declarations.push(node.stroke.align === 'outside' || node.stroke.align === 'center' ? ['outline', value] : ['border', value])
  }

  const shadows: string[] = []
  for (const effect of toArray(node.effect)) {
    if (effect.enabled === false) {
      continue
    }
    if (effect.type === 'blur') {
      declarations.push(['filter', `blur(${px(effect.radius)})`])
      continue
    }
    const offset = effect.offset ?? { x: 0, y: 0 }
    const inset = effect.shadowType === 'inner' && node.type !== 'text' ? 'inset ' : ''
    shadows.push(`${inset}${px(offset.x)} ${px(offset.y)} ${px(effect.blur ?? 0)} ${color(effect.color ?? '#00000040')}`)
  }
  if (shadows.length) {
    declarations.push([node.type === 'text' ? 'text-shadow' : 'box-shadow', shadows.join(', ')])
  }
}

function textStyles(node: Node, fonts: Set<string>, declarations: Declaration[]): void {
  if (node.type !== 'text') {
    return
  }
  declarations.push(['margin', '0'])
  const fill = textColor(node)
  if (fill) {
    declarations.push(['color', fill])
  }
  if (node.fontFamily) {
    fonts.add(node.fontFamily)
    declarations.push(['font-family', `"${node.fontFamily}"`])
  }
  if (node.fontSize !== undefined) {
    declarations.push(['font-size', length(node.fontSize)])
  }
  if (node.fontWeight !== undefined) {
    declarations.push(['font-weight', String(node.fontWeight)])
  }
  if (node.fontStyle === 'italic') {
    declarations.push(['font-style', 'italic'])
  }
  if (node.letterSpacing !== undefined) {
    declarations.push(['letter-spacing', px(node.letterSpacing)])
  }
  if (node.lineHeight !== undefined) {
    declarations.push(['line-height', String(node.lineHeight)])
  }
  if (node.textAlign && node.textAlign !== 'left') {
    declarations.push(['text-align', node.textAlign])
  }
  if (node.content.includes('\n')) {
    declarations.push(['white-space', 'pre-wrap'])
  }
}

function sizeStyles(node: Node, rect: Rect, parentRect: Rect | null, parentLayout: Layout | null, declarations: Declaration[]): void {
  const ownLayout: Layout = node.type === 'frame' ? (node.layout ?? 'none') : 'none'
  const hugs = node.type === 'text' || (hasChildren(node) && node.children.length > 0 && ownLayout !== 'none')

  if (parentLayout === 'none' && parentRect) {
    declarations.push(['position', 'absolute'], ['left', px(rect.x - parentRect.x)], ['top', px(rect.y - parentRect.y)])
  }

  let fixed = false
  for (const axis of ['width', 'height'] as const) {
    const sizing = parseSizing(node[axis])
    const measured = axis === 'width' ? rect.width : rect.height
    const isMain = parentLayout !== null && parentLayout !== 'none' && (parentLayout === 'horizontal') === (axis === 'width')

    if (sizing.kind === 'fixed') {
      declarations.push([axis, px(sizing.value)])
      fixed = fixed || isMain
    } else if (sizing.kind === 'fill_container' && parentLayout !== null && parentLayout !== 'none') {
      declarations.push(...(isMain ? ([['flex', '1 1 0'], [axis === 'width' ? 'min-width' : 'min-height', '0']] as Declaration[]) : ([['align-self', 'stretch']] as Declaration[])))
    } else if (sizing.kind === 'fill_container' || !hugs) {
      declarations.push([axis, px(measured)])
    }
  }
  if (fixed) {
    declarations.push(['flex-shrink', '0'])
  }

  if (node.type === 'frame' && ownLayout !== 'none') {
    declarations.push(['display', 'flex'], ['flex-direction', ownLayout === 'horizontal' ? 'row' : 'column'])
    if (node.gap !== undefined) {
      declarations.push(['gap', length(node.gap)])
    }
    if (node.padding !== undefined) {
      const padding = typeof node.padding === 'number' ? [node.padding] : node.padding
      declarations.push(['padding', padding.map(length).join(' ')])
    }
    if (node.justifyContent && node.justifyContent !== 'start') {
      declarations.push(['justify-content', JUSTIFY[node.justifyContent]])
    }
    if (node.alignItems) {
      declarations.push(['align-items', ALIGN[node.alignItems]])
    }
  } else if (hasChildren(node) && node.children.length > 0 && parentLayout !== 'none') {
    declarations.push(['position', 'relative'])
  }
}

const KEYWORD_CLASSES: Record<string, string> = {
  'display:flex': 'flex',
  'flex-direction:row': 'flex-row',
  'flex-direction:column': 'flex-col',
  'position:absolute': 'absolute',
  'position:relative': 'relative',
  'flex:1 1 0': 'flex-1',
  'min-width:0': 'min-w-0',
  'min-height:0': 'min-h-0',
  'flex-shrink:0': 'shrink-0',
  'align-self:stretch': 'self-stretch',
  'justify-content:center': 'justify-center',
  'justify-content:flex-end': 'justify-end',
  'justify-content:space-between': 'justify-between',
  'justify-content:space-around': 'justify-around',
  'align-items:flex-start': 'items-start',
  'align-items:center': 'items-center',
  'align-items:flex-end': 'items-end',
  'font-style:italic': 'italic',
  'text-align:center': 'text-center',
  'text-align:right': 'text-right',
  'white-space:pre-wrap': 'whitespace-pre-wrap',
  'margin:0': 'm-0',
  'border-radius:50%': 'rounded-full',
}

const VALUE_PREFIXES: Record<string, string> = {
  width: 'w',
  height: 'h',
  'min-height': 'min-h',
  left: 'left',
  top: 'top',
  gap: 'gap',
  padding: 'p',
  'background-color': 'bg',
  'font-size': 'text',
  'font-weight': 'font',
  'font-family': 'font',
  'letter-spacing': 'tracking',
  'line-height': 'leading',
  'border-radius': 'rounded',
  'box-shadow': 'shadow',
}

function arbitrary(value: string): string {
  return value.replace(/"/g, "'").replace(/ /g, '_')
}

function tailwindClass([property, value]: Declaration): string {
  const keyword = KEYWORD_CLASSES[`${property}:${value}`]
  if (keyword) {
    return keyword
  }
  if (property === 'color') {
    return `text-[color:${arbitrary(value)}]`
  }
  const prefix = VALUE_PREFIXES[property]
  return prefix ? `${prefix}-[${arbitrary(value)}]` : `[${property}:${arbitrary(value)}]`
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'node'
}

export function variablesCss(variables: Record<string, Variable> = {}): string {
  const base: string[] = []
  const themed = new Map<string, string[]>()

  for (const [name, variable] of Object.entries(variables)) {
    const values = Array.isArray(variable.value) ? variable.value : [{ value: variable.value, theme: undefined }]
    const fallback = values.find((entry) => !entry.theme) ?? values[0]
    if (fallback) {
      base.push(`  --${name}: ${String(fallback.value)};`)
    }
    for (const entry of values) {
      if (!entry.theme) {
        continue
      }
      const selector = Object.entries(entry.theme).map(([axis, option]) => `[data-${slug(axis)}="${option}"]`).join('')
      themed.set(selector, [...(themed.get(selector) ?? []), `  --${name}: ${String(entry.value)};`])
    }
  }

  const blocks = base.length ? [`:root {\n${base.join('\n')}\n}`] : []
  for (const [selector, lines] of themed) {
    blocks.push(`${selector} {\n${lines.join('\n')}\n}`)
  }
  return blocks.join('\n\n')
}

export function exportHtml(
  root: Node,
  rects: Map<string, Rect>,
  format: ExportFormat,
  variables?: Record<string, Variable>
): ExportResult {
  const fonts = new Set<string>()
  const images = new Set<string>()
  const rules: string[] = []
  const usedClasses = new Map<string, number>()

  function render(node: Node, parentRect: Rect | null, parentLayout: Layout | null, indent: string): string {
    const rect = rects.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 }
    const declarations: Declaration[] = []
    if (parentLayout === null) {
      declarations.push(['position', 'relative'])
    }
    sizeStyles(node, rect, parentRect, parentLayout, declarations)
    boxStyles(node, images, declarations)
    textStyles(node, fonts, declarations)

    const image = onlyImage(node)
    if (image) {
      images.add(image)
      declarations.push(['object-fit', toArray(node.fill).some((fill) => typeof fill === 'object' && fill.type === 'image' && fill.mode === 'contain') ? 'contain' : 'cover'])
    }

    let classAttribute: string
    if (format === 'html-tailwind') {
      classAttribute = declarations.map(tailwindClass).join(' ')
    } else {
      const base = slug(node.name ?? node.type)
      const count = (usedClasses.get(base) ?? 0) + 1
      usedClasses.set(base, count)
      classAttribute = count === 1 ? base : `${base}-${count}`
      if (declarations.length) {
        rules.push(`.${classAttribute} {\n${declarations.map(([property, value]) => `  ${property}: ${value};`).join('\n')}\n}`)
      }
    }

    const attributes = `class="${escapeHtml(classAttribute)}"${node.name ? ` data-name="${escapeHtml(node.name)}"` : ''}`

    if (image) {
      return `${indent}<img ${attributes} src="${escapeHtml(image)}" alt="${escapeHtml(node.name ?? '')}" />`
    }
    if (node.type === 'text') {
      return `${indent}<p ${attributes}>${escapeHtml(node.content)}</p>`
    }
    if (!hasChildren(node) || node.children.length === 0) {
      return `${indent}<div ${attributes}></div>`
    }
    const layout: Layout = node.type === 'frame' ? (node.layout ?? 'none') : 'none'
    const children = node.children.map((child) => render(child, rect, layout, `${indent}  `)).join('\n')
    return `${indent}<div ${attributes}>\n${children}\n${indent}</div>`
  }

  const html = render(root, null, null, '')
  const tokens = variablesCss(variables)
  const css = format === 'html-css' ? ['* { box-sizing: border-box; }', tokens, ...rules].filter(Boolean).join('\n\n') : tokens

  return { html, css, fonts: [...fonts], images: [...images] }
}
