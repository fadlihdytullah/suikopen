import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { ChatRecord } from '../src/shared/agent'

const dir = await mkdtemp(`${tmpdir()}/chats-`)
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { deleteChat, getChat, listChats, saveChat } = await import('../src/main/agent/chats')
const { relativeTime } = await import('../src/renderer/ui/ChatPicker')

const record = (id: string, documentPath: string | null, updatedAt: number): ChatRecord => ({
  id,
  title: id,
  documentPath,
  provider: 'claude',
  model: 'default',
  sessionId: null,
  createdAt: updatedAt,
  updatedAt,
  entries: [{ kind: 'user', text: id, skills: [], files: [] }],
})

describe('chat history', () => {
  it('saves, lists per document newest first, and deletes', async () => {
    await saveChat(record('a', '/d/one.spen', 1))
    await saveChat(record('b', '/d/one.spen', 3))
    await saveChat(record('c', null, 2))
    expect((await listChats('/d/one.spen')).map((chat) => chat.id)).toEqual(['b', 'a'])
    expect((await listChats()).map((chat) => chat.id)).toEqual(['b', 'c', 'a'])
    expect((await getChat('a'))?.entries).toHaveLength(1)
    await deleteChat('a')
    expect(await getChat('a')).toBeNull()
  })

  it('rejects ids that could escape the folder', async () => {
    await expect(saveChat(record('../evil', null, 1))).rejects.toThrow('Invalid chat id.')
  })

  it('formats relative times', () => {
    const now = 10 * 86_400_000
    expect(relativeTime(now - 30_000, now)).toBe('now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h')
    expect(relativeTime(now - 86_400_000, now)).toBe('Yesterday')
  })
})

describe('chats per untitled tab', () => {
  it('keeps untitled chats apart per tab and saved files per path', async () => {
    const { listChats, saveChat } = await import('../src/main/agent/chats')
    const base = { provider: 'claude' as const, model: 'default', sessionId: null, createdAt: 1, entries: [] }
    await saveChat({ ...base, id: 'u-a', title: 'A', documentPath: null, tabId: 'tab-a', updatedAt: 1 })
    await saveChat({ ...base, id: 'u-b', title: 'B', documentPath: null, tabId: 'tab-b', updatedAt: 2 })
    await saveChat({ ...base, id: 'p-1', title: 'P', documentPath: '/x/talangin.spen', tabId: 'tab-a', updatedAt: 3 })
    expect((await listChats(null, 'tab-a')).map((chat) => chat.id)).toEqual(['u-a'])
    expect((await listChats(null, 'tab-b')).map((chat) => chat.id)).toEqual(['u-b'])
    expect((await listChats('/x/talangin.spen', 'tab-z')).map((chat) => chat.id)).toEqual(['p-1'])
  })
})
