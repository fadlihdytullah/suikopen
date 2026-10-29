import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCheckpoint, readDocument, writeCheckpoint, writeDocument } from '../src/main/file-io'
import { parseDocument, type Document } from '../src/shared/schema/document'

const sample: Document = {
  version: 1,
  children: [{ id: 'r1', type: 'rectangle', x: 1, y: 2, width: 3, height: 4, fill: '#ff0000' }],
}

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'suikopen-'))
}

describe('writeDocument', () => {
  it('round-trips a document through disk', async () => {
    const directory = await workspace()
    const path = join(directory, 'doc.spen')

    await writeDocument(path, sample)

    expect(await readDocument(path)).toEqual(sample)
  })

  it('leaves no temporary file behind', async () => {
    const directory = await workspace()

    await writeDocument(join(directory, 'doc.spen'), sample)

    expect(await readdir(directory)).toEqual(['doc.spen'])
  })

  it('replaces an existing file atomically', async () => {
    const directory = await workspace()
    const path = join(directory, 'doc.spen')
    await writeDocument(path, sample)

    const next: Document = { ...sample, children: [{ ...sample.children[0]!, x: 99 } as never] }
    await writeDocument(path, next)

    expect((await readDocument(path)).children[0]?.x).toBe(99)
  })

  it('writes json the parser accepts verbatim', async () => {
    const directory = await workspace()
    const path = join(directory, 'doc.spen')

    await writeDocument(path, sample)
    const text = await readFile(path, 'utf8')

    expect(text.endsWith('\n')).toBe(true)
    expect(parseDocument(JSON.parse(text))).toEqual(sample)
  })
})

describe('readDocument', () => {
  it('reports a missing file without throwing a raw fs error', async () => {
    const directory = await workspace()

    await expect(readDocument(join(directory, 'nope.spen'))).rejects.toThrow(/Could not read/)
  })

  it('reports invalid json with the parser message', async () => {
    const directory = await workspace()
    const path = join(directory, 'broken.spen')
    await writeFile(path, '{ not json', 'utf8')

    await expect(readDocument(path)).rejects.toThrow(/not valid JSON/)
  })
})

describe('checkpoint', () => {
  it('round-trips and rejects an invalid document', async () => {
    const directory = await workspace()
    const path = join(directory, 'recovery.json')
    const checkpoint = { document: sample, path: '/tmp/doc.spen', assetBase: null, dirty: true }

    await writeCheckpoint(path, checkpoint)
    expect(await readCheckpoint(path)).toEqual(checkpoint)

    await writeFile(path, JSON.stringify({ ...checkpoint, document: { version: 1, children: 'nope' } }))
    expect(await readCheckpoint(path)).toBeNull()
  })
})
