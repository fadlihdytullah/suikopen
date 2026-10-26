import { DOCUMENT_VERSION, parseDocument, type Document } from './schema/document'

type Raw = Record<string, any>

const NODE_TYPES = new Set(['frame', 'group', 'rectangle', 'ellipse', 'text', 'ref'])
const SIZING = /^(fit_content|fill_container)(\(\d+(\.\d+)?\))?$/
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const REF = /^\$[A-Za-z0-9_-]+$/
const FONT_WEIGHTS: Record<string, number> = { normal: 400, regular: 400, medium: 500, semibold: 600, bold: 700 }
const IMAGE_MODES: Record<string, string> = { fill: 'cover', cover: 'cover', fit: 'contain', contain: 'contain', stretch: 'stretch' }
const STROKE_ALIGN: Record<string, string> = { inner: 'inside', inside: 'inside', center: 'center', outer: 'outside', outside: 'outside' }

export function importPen(input: unknown): Document {
  const pen = input as Raw
  if (typeof pen !== 'object' || pen === null || !Array.isArray(pen.children)) {
    throw new Error('Not a .pen document: no children array.')
  }

  const variables: Raw = pen.variables ?? {}
  const nodesById = new Map<string, Raw>()
  const index = (nodes: Raw[]) => {
    for (const node of nodes) {
      nodesById.set(node.id, node)
      if (Array.isArray(node.children)) index(node.children)
    }
  }
  index(pen.children)

  const deref = (value: unknown): unknown => {
    if (typeof value !== 'string' || !value.startsWith('$')) return value
    const found = variables[value.slice(1)]?.value
    return Array.isArray(found) ? found[0]?.value : found
  }
  const num = (value: unknown, fallback = 0): number => {
    const resolved = deref(value)
    return typeof resolved === 'number' ? resolved : fallback
  }
  const numberValue = (value: unknown) => (typeof value === 'string' && REF.test(value) && typeof deref(value) === 'number' ? value : num(value))
  const color = (value: unknown): string | undefined => {
    if (typeof value === 'string' && REF.test(value)) return value
    const resolved = deref(value)
    return typeof resolved === 'string' && HEX.test(resolved) ? resolved : undefined
  }

  const sizing = (value: unknown): unknown => {
    if (typeof value === 'string' && SIZING.test(value)) return value
    const resolved = num(value, Number.NaN)
    return Number.isNaN(resolved) ? undefined : Math.max(0, resolved)
  }

  const fill = (value: unknown): unknown => {
    if (typeof value === 'string') return color(value)
    const paint = value as Raw
    if (!paint || typeof paint !== 'object') return undefined
    const common = { ...(paint.enabled === false ? { enabled: false } : {}), ...(typeof paint.opacity === 'number' ? { opacity: paint.opacity } : {}) }
    if (paint.type === 'color' && color(paint.color)) return { type: 'color', color: paint.color, ...common }
    if (paint.type === 'gradient') {
      const colors = (paint.colors ?? [])
        .filter((stop: Raw) => color(stop.color))
        .map((stop: Raw) => ({ color: stop.color, position: Math.min(1, Math.max(0, num(stop.position))) }))
      if (colors.length < 2) return undefined
      return { type: 'gradient', gradientType: ['linear', 'radial', 'angular'].includes(paint.gradientType) ? paint.gradientType : 'linear', rotation: num(paint.rotation), colors, ...common }
    }
    if (paint.type === 'image' && typeof paint.url === 'string' && paint.url) {
      return { type: 'image', url: paint.url, mode: IMAGE_MODES[paint.mode] ?? 'cover', ...common }
    }
    return undefined
  }
  const fills = (value: unknown): unknown => {
    if (!Array.isArray(value)) return fill(value)
    const list = value.map(fill).filter((entry) => entry !== undefined)
    return list.length ? list : undefined
  }

  const strokeColor = (value: unknown): string | undefined => {
    if (typeof value === 'string') return color(value)
    const paint = value as Raw
    if (paint?.enabled === false) return undefined
    if (paint?.type === 'color') return color(paint.color)
    if (paint?.type === 'gradient') return color(paint.colors?.[0]?.color)
    return Array.isArray(value) ? strokeColor(value[0]) : undefined
  }

  const effect = (value: unknown): unknown => {
    const entry = value as Raw
    if (entry?.type === 'blur') return { type: 'blur', radius: Math.max(0, num(entry.radius)), ...(entry.enabled === false ? { enabled: false } : {}) }
    if (entry?.type !== 'shadow') return undefined
    return {
      type: 'shadow',
      shadowType: entry.shadowType === 'inner' ? 'inner' : 'outer',
      offset: { x: num(entry.offset?.x), y: num(entry.offset?.y) },
      blur: Math.max(0, num(entry.blur)),
      ...(color(entry.color) ? { color: entry.color } : {}),
      ...(entry.enabled === false ? { enabled: false } : {}),
    }
  }
  const effects = (value: unknown): unknown => {
    const list = (Array.isArray(value) ? value : [value]).map(effect).filter((entry) => entry !== undefined)
    return list.length ? list : undefined
  }

  const quad = (value: unknown): unknown =>
    Array.isArray(value) ? (value.length === 2 || value.length === 4 ? value.map((entry) => num(entry)) : num(value[0])) : undefined

  const props = (source: Raw, type: string): Raw => {
    const out: Raw = {}
    const set = (key: string, value: unknown) => {
      if (value !== undefined) out[key] = value
    }

    if ('name' in source) set('name', source.name)
    if (source.enabled === false) set('visible', false)
    if (source.locked === true) set('locked', true)
    if ('x' in source) set('x', num(source.x))
    if ('y' in source) set('y', num(source.y))
    if ('width' in source) set('width', sizing(source.width))
    if ('height' in source) set('height', sizing(source.height))
    if ('fill' in source && type !== 'icon') set('fill', fills(source.fill))
    if ('stroke' in source || 'strokeWidth' in source) {
      const strokeValue = strokeColor(source.stroke)
      const width = num(source.strokeWidth, 1)
      if (strokeValue && width > 0) set('stroke', { color: strokeValue, width, align: STROKE_ALIGN[source.strokeAlignment] ?? 'inside' })
    }
    if ('effect' in source) set('effect', effects(source.effect))
    if ('cornerRadius' in source && type !== 'text' && type !== 'ellipse') {
      const radius = source.cornerRadius
      set('cornerRadius', Array.isArray(radius) ? (radius.length === 4 ? radius.map((entry) => num(entry)) : num(radius[0])) : numberValue(radius))
    }

    if (type === 'frame') {
      if ('layout' in source) set('layout', ['none', 'vertical', 'horizontal'].includes(source.layout) ? source.layout : 'horizontal')
      if ('gap' in source) set('gap', numberValue(source.gap))
      if ('padding' in source) set('padding', Array.isArray(source.padding) ? quad(source.padding) : Math.max(0, num(source.padding)))
      if (['start', 'center', 'end', 'space_between', 'space_around'].includes(source.justifyContent)) set('justifyContent', source.justifyContent)
      if (['start', 'center', 'end'].includes(source.alignItems)) set('alignItems', source.alignItems)
    }

    if (type === 'text') {
      if ('content' in source) set('content', String(source.content ?? ''))
      if (typeof source.fontFamily === 'string') set('fontFamily', source.fontFamily)
      if ('fontSize' in source) set('fontSize', numberValue(source.fontSize))
      if ('fontWeight' in source) {
        const raw = deref(source.fontWeight)
        const weight = typeof raw === 'number' ? raw : FONT_WEIGHTS[String(raw).toLowerCase()] ?? Number(raw)
        if (Number.isFinite(weight)) set('fontWeight', Math.min(900, Math.max(100, Math.round(weight / 100) * 100)))
      }
      if (source.fontStyle === 'italic' || source.fontStyle === 'normal') set('fontStyle', source.fontStyle)
      if ('letterSpacing' in source) set('letterSpacing', num(source.letterSpacing))
      if ('lineHeight' in source && num(source.lineHeight) > 0) set('lineHeight', num(source.lineHeight))
      if (['left', 'center', 'right'].includes(source.textAlign)) set('textAlign', source.textAlign)
    }

    return out
  }

  const textSize = (source: Raw) => {
    const growth = source.textGrowth ?? 'auto'
    return {
      width: growth === 'auto' ? 'fit_content' : sizing(source.width) ?? 'fit_content',
      height: growth === 'fixed-width-height' ? sizing(source.height) ?? 'fit_content' : 'fit_content',
    }
  }

  const findPath = (root: Raw, id: string, path: string): string | undefined => {
    for (const child of root.children ?? []) {
      const childPath = `${path}/${child.id}`
      if (child.id === id) return childPath
      const nested = findPath(child, id, childPath)
      if (nested) return nested
    }
    return undefined
  }

  const convert = (source: Raw): Raw | undefined => {
    if (!source || typeof source !== 'object') return undefined

    const master = source.type === 'ref' ? nodesById.get(source.ref) : undefined
    const type = source.type === 'ref' && !master ? 'missing-ref' : source.type
    const known = NODE_TYPES.has(type)
    const base: Raw = {
      id: String(source.id),
      ...props(source, known ? type : 'rectangle'),
      type: known ? type : 'rectangle',
      x: num(source.x),
      y: num(source.y),
    }
    base.width ??= type === 'frame' || type === 'group' ? 'fit_content' : sizing(master?.width) ?? 0
    base.height ??= type === 'frame' || type === 'group' ? 'fit_content' : sizing(master?.height) ?? 0
    if (!known) delete base.fill

    if (type === 'text') {
      Object.assign(base, textSize(source))
      base.content ??= ''
    }

    if (type === 'frame') base.layout ??= 'horizontal'

    if (type === 'frame' || type === 'group') {
      base.children = (source.children ?? []).map(convert).filter(Boolean)
    }

    if (type === 'ref' && master) {
      const { x: _x, y: _y, ...rootPatch } = props(source, master.type)
      const overrides: Record<string, Raw> = {}
      if (Object.keys(rootPatch).length) overrides[master.id] = rootPatch
      for (const [key, patch] of Object.entries(source.descendants ?? {})) {
        const targetId = key.split('/').pop() as string
        const path = findPath(master, targetId, master.id)
        const target = nodesById.get(targetId)
        if (!path || !target) continue
        const converted = props(patch as Raw, target.type)
        if (target.type === 'text' && ('width' in (patch as Raw) || 'height' in (patch as Raw))) {
          Object.assign(converted, textSize({ ...target, ...(patch as Raw) }))
        }
        if (Object.keys(converted).length) overrides[path] = converted
      }
      base.masterId = master.id
      if (Object.keys(overrides).length) base.overrides = overrides
    }

    return base
  }

  const convertVariable = (variable: Raw): Raw | undefined => {
    if (!['color', 'number', 'string', 'boolean'].includes(variable?.type)) return undefined
    const valid = (value: unknown) => (variable.type === 'color' ? typeof value === 'string' && HEX.test(value) : typeof value === variable.type)
    if (!Array.isArray(variable.value)) return valid(variable.value) ? { type: variable.type, value: variable.value } : undefined
    const entries = variable.value.filter((entry: Raw) => valid(entry?.value)).map((entry: Raw) => (entry.theme ? { value: entry.value, theme: entry.theme } : { value: entry.value }))
    return entries.length ? { type: variable.type, value: entries } : undefined
  }

  const convertedVariables = Object.fromEntries(
    Object.entries(variables)
      .map(([name, variable]) => [name, convertVariable(variable as Raw)] as const)
      .filter(([, variable]) => variable !== undefined)
  )

  return parseDocument({
    version: DOCUMENT_VERSION,
    ...(pen.themes && Object.keys(pen.themes).length ? { themes: pen.themes } : {}),
    ...(Object.keys(convertedVariables).length ? { variables: convertedVariables } : {}),
    children: pen.children.map(convert).filter(Boolean),
  })
}
