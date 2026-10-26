import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, dialog: {}, ipcMain: {}, net: {} }))

const { insideRoot } = await import('../src/main/ipc')

describe('insideRoot', () => {
  it('rejects traversal and sibling prefixes', () => {
    expect(insideRoot('/a/designs', '/a/designs/img/x.png')).toBe(true)
    expect(insideRoot('/a/designs', '/a/designs-secret/x.png')).toBe(false)
    expect(insideRoot('/a/designs', '/a/x.png')).toBe(false)
    expect(insideRoot('/a/designs', '/a/designs')).toBe(false)
  })
})
