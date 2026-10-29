import { z } from 'zod'
import { HexColor, NodeSchema, type Node } from './node'
import { MemorySchema, type MemoryNote } from './memory'

export const DOCUMENT_VERSION = 1

const Theme = z.record(z.string().min(1), z.string().min(1))

function themed<T extends z.ZodTypeAny>(value: T) {
  return z.union([value, z.array(z.object({ value, theme: Theme.optional() })).min(1)])
}

export const VariableSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('color'), value: themed(HexColor) }),
  z.object({ type: z.literal('number'), value: themed(z.number()) }),
  z.object({ type: z.literal('string'), value: themed(z.string()) }),
  z.object({ type: z.literal('boolean'), value: themed(z.boolean()) }),
])

export const DocumentSchema = z.object({
  version: z.literal(DOCUMENT_VERSION),
  themes: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)).optional(),
  variables: z.record(z.string().min(1), VariableSchema).optional(),
  children: z.array(NodeSchema),
  memory: MemorySchema.optional(),
})

export type ThemeSelection = Record<string, string>
export type Variable = z.infer<typeof VariableSchema>
export type Document = {
  version: typeof DOCUMENT_VERSION
  themes?: Record<string, string[]>
  variables?: Record<string, Variable>
  children: Node[]
  memory?: MemoryNote[]
}

export class DocumentParseError extends Error {
  readonly issues: { path: string; message: string }[]

  constructor(message: string, issues: { path: string; message: string }[] = []) {
    super(message)
    this.name = 'DocumentParseError'
    this.issues = issues
  }
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') {
      return `${acc}[${key}]`
    }
    return acc ? `${acc}.${String(key)}` : String(key)
  }, '')
}

function readVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }
  const version = (input as { version?: unknown }).version
  return typeof version === 'number' ? version : undefined
}

export function parseDocument(input: unknown): Document {
  const version = readVersion(input)

  if (version === undefined) {
    throw new DocumentParseError('Not a .spen document: no version field.')
  }

  if (version !== DOCUMENT_VERSION) {
    throw new DocumentParseError(
      `Unsupported document version ${version}. This build reads version ${DOCUMENT_VERSION}.`
    )
  }

  const result = DocumentSchema.safeParse(input)

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
    }))
    const first = issues[0]
    throw new DocumentParseError(
      first ? `${first.path || 'document'}: ${first.message}` : 'Malformed document.',
      issues
    )
  }

  return result.data
}
