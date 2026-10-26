import { z } from 'zod'

export const HexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
  message: 'Expected a hex colour such as #112233 or #112233ff',
})

export const VariableRef = z.string().regex(/^\$[A-Za-z0-9_-]+$/, { message: 'Expected a variable reference such as $accent' })

export const ColorValue = z.union([HexColor, VariableRef])

export const NumberValue = z.union([z.number(), VariableRef])

export const SizingBehavior = z
  .string()
  .regex(/^(fit_content|fill_container)(\(\d+(\.\d+)?\))?$/, {
    message: 'Expected fit_content, fill_container, or either with a fallback such as fit_content(100)',
  })

export const Sizing = z.union([z.number().nonnegative(), SizingBehavior])

export const LayoutMode = z.enum(['none', 'vertical', 'horizontal'])
export const JustifyContent = z.enum(['start', 'center', 'end', 'space_between', 'space_around'])
export const AlignItems = z.enum(['start', 'center', 'end'])

export const Padding = z.union([
  z.number().nonnegative(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
])

export const SolidFill = z.object({
  type: z.literal('color'),
  enabled: z.boolean().optional(),
  color: ColorValue,
  opacity: z.number().min(0).max(1).optional(),
})

export const GradientStop = z.object({ color: ColorValue, position: z.number().min(0).max(1) })

export const GradientFill = z.object({
  type: z.literal('gradient'),
  enabled: z.boolean().optional(),
  gradientType: z.enum(['linear', 'radial', 'angular']).optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  colors: z.array(GradientStop).min(2),
})

export const ImageFill = z.object({
  type: z.literal('image'),
  enabled: z.boolean().optional(),
  url: z.string().min(1),
  mode: z.enum(['cover', 'contain', 'stretch']).optional(),
  opacity: z.number().min(0).max(1).optional(),
})

export const Fill = z.union([ColorValue, SolidFill, GradientFill, ImageFill])
export const Fills = z.union([Fill, z.array(Fill)])

export const Stroke = z.object({
  color: ColorValue,
  width: z.number().nonnegative().optional(),
  align: z.enum(['inside', 'center', 'outside']).optional(),
  enabled: z.boolean().optional(),
})

export const BlurEffect = z.object({
  type: z.literal('blur'),
  enabled: z.boolean().optional(),
  radius: z.number().nonnegative(),
})

export const ShadowEffect = z.object({
  type: z.literal('shadow'),
  enabled: z.boolean().optional(),
  shadowType: z.enum(['inner', 'outer']).optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
  blur: z.number().nonnegative().optional(),
  color: ColorValue.optional(),
})

export const Effect = z.union([BlurEffect, ShadowEffect])
export const Effects = z.union([Effect, z.array(Effect)])

export const CornerRadius = z.union([
  NumberValue,
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
])

const BaseNode = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  x: z.number(),
  y: z.number(),
  width: Sizing,
  height: Sizing,
  fill: Fills.optional(),
  stroke: Stroke.optional(),
  effect: Effects.optional(),
})

export const RectangleNode = BaseNode.extend({
  type: z.literal('rectangle'),
  cornerRadius: CornerRadius.optional(),
})

export const EllipseNode = BaseNode.extend({
  type: z.literal('ellipse'),
})

export const TextNode = BaseNode.extend({
  type: z.literal('text'),
  content: z.string(),
  fontFamily: z.string().optional(),
  fontSize: NumberValue.optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().positive().optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
})

export const FrameNode = BaseNode.extend({
  type: z.literal('frame'),
  cornerRadius: CornerRadius.optional(),
  layout: LayoutMode.optional(),
  gap: NumberValue.optional(),
  padding: Padding.optional(),
  justifyContent: JustifyContent.optional(),
  alignItems: AlignItems.optional(),
  get children() {
    return z.array(NodeSchema).default([])
  },
})

export const GroupNode = BaseNode.extend({
  type: z.literal('group'),
  get children() {
    return z.array(NodeSchema).default([])
  },
})

export const RefNode = BaseNode.extend({
  type: z.literal('ref'),
  masterId: z.string().min(1),
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})

export const NodeSchema = z.discriminatedUnion('type', [
  RectangleNode,
  EllipseNode,
  TextNode,
  FrameNode,
  GroupNode,
  RefNode,
])

export type Node = z.infer<typeof NodeSchema>
export type SizingValue = z.infer<typeof Sizing>
export type LayoutModeValue = z.infer<typeof LayoutMode>
export type PaddingValue = z.infer<typeof Padding>
export type FillValue = z.infer<typeof Fill>
export type FillsValue = z.infer<typeof Fills>
export type StrokeValue = z.infer<typeof Stroke>
export type EffectValue = z.infer<typeof Effect>
export type EffectsValue = z.infer<typeof Effects>
export type CornerRadiusValue = z.infer<typeof CornerRadius>
export type TextNodeValue = z.infer<typeof TextNode>

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback
}

export function cornerRadii(value: CornerRadiusValue | undefined): [number, number, number, number] {
  if (value === undefined || typeof value === 'string') {
    return [0, 0, 0, 0]
  }
  if (typeof value === 'number') {
    return [value, value, value, value]
  }
  return value.map((entry) => asNumber(entry)) as [number, number, number, number]
}
export type FrameNode = z.infer<typeof FrameNode>
export type GroupNode = z.infer<typeof GroupNode>
export type RefNodeValue = z.infer<typeof RefNode>
export type ParentNode = FrameNode | GroupNode

export function hasChildren(node: Node): node is ParentNode {
  return node.type === 'frame' || node.type === 'group'
}
