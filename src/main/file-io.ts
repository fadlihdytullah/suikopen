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

export async function writeDocument(path: string, document: Document): Promise<void> {
  const temporary = join(dirname(path), `.${Date.now()}.spen.tmp`)
  const handle = await open(temporary, 'w')

  try {
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
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
