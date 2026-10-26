import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ATTACHMENT_SUPPORT, classifyAttachment } from '../src/shared/agent'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, nativeImage: { createFromPath: () => ({ isEmpty: () => true }) } }))

const { describeAttachment, promptWithText } = await import('../src/main/agent/attachments')

describe('attachments', () => {
  it('classifies by extension', () => {
    expect(classifyAttachment('shot.PNG')).toEqual({ kind: 'image', mime: 'image/png' })
    expect(classifyAttachment('brief.pdf')?.kind).toBe('pdf')
    expect(classifyAttachment('notes.md')?.kind).toBe('text')
    expect(classifyAttachment('movie.mov')).toBeNull()
    expect(ATTACHMENT_SUPPORT.codex).not.toContain('pdf')
  })

  it('describes files and rejects unsupported ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'attach-'))
    await writeFile(join(dir, 'brief.md'), '# Hello')
    expect(await describeAttachment(join(dir, 'brief.md'))).toMatchObject({ name: 'brief.md', kind: 'text', size: 7 })
    expect(await describeAttachment(join(dir, 'clip.mov'))).toEqual({ name: 'clip.mov', error: "This file type isn't supported." })
    expect(await describeAttachment(join(dir, 'missing.png'))).toEqual({ name: 'missing.png', error: "Couldn't read this file." })
  })

  it('inlines text files ahead of the prompt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'attach-'))
    const path = join(dir, 'brief.md')
    await writeFile(path, 'Make it blue')
    const prompt = await promptWithText('Design it', [{ path, name: 'brief.md', kind: 'text', mime: 'text/plain', size: 12 }])
    expect(prompt).toBe('<attached_file name="brief.md">\nMake it blue\n</attached_file>\n\nDesign it')
  })
})

describe('long paste', async () => {
  const { isLongPaste, formatSize } = await import('../src/renderer/ui/Attachments')

  it('switches to a chip past 10 lines or 800 characters', () => {
    expect(isLongPaste('short')).toBe(false)
    expect(isLongPaste(Array(10).fill('x').join('\n'))).toBe(false)
    expect(isLongPaste(Array(11).fill('x').join('\n'))).toBe(true)
    expect(isLongPaste('x'.repeat(801))).toBe(true)
    expect(formatSize(4300)).toBe('4 KB')
  })
})
