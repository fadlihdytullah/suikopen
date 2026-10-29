import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { importPen } from '../shared/pen-import'
import { DocumentParseError, parseDocument, type Document } from '../shared/schema/document'

export async function readDocument(path: string): Promise<Document> {
  let text: string

  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new DocumentParseError(`Could not read ${path}.`)
  }

  let json: unknown

  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new DocumentParseError(`${path} is not valid JSON: ${(error as Error).message}`)
  }

  if (path.toLowerCase().endsWith('.pen')) {
    try {
      return importPen(json)
    } catch (error) {
      throw new DocumentParseError(`Could not import ${path}: ${(error as Error).message}`)
    }
  }

  return parseDocument(json)
}

export type Checkpoint = { document: Document; path: string | null; assetBase: string | null; dirty: boolean }

export function toCheckpoint(value: unknown): Checkpoint | null {
  try {
    const candidate = value as Partial<Checkpoint>
    return {
      document: parseDocument(candidate.document),
      path: typeof candidate.path === 'string' ? candidate.path : null,
      assetBase: typeof candidate.assetBase === 'string' ? candidate.assetBase : null,
      dirty: candidate.dirty === true,
    }
  } catch {
    return null
  }
}

export async function readCheckpoint(path: string): Promise<Checkpoint | null> {
  try {
    return toCheckpoint(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}

export function writeCheckpoint(path: string, checkpoint: Checkpoint): Promise<void> {
  return writeFileAtomic(path, JSON.stringify(checkpoint))
}

export function writeDocument(path: string, document: Document): Promise<void> {
  return writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`)
}

export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'w')

  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}
