import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ChatRecord, ChatSummary } from '../../shared/agent'

const ID = /^[A-Za-z0-9-]{1,64}$/

function directory(): string {
  return join(app.getPath('userData'), 'chats')
}

function fileFor(id: string): string {
  if (!ID.test(id)) {
    throw new Error('Invalid chat id.')
  }
  return join(directory(), `${id}.json`)
}

export async function listChats(documentPath?: string | null, tabId?: string): Promise<ChatSummary[]> {
  let names: string[] = []
  try {
    names = (await readdir(directory())).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
  const chats = await Promise.all(
    names.map(async (name) => {
      try {
        const record = JSON.parse(await readFile(join(directory(), name), 'utf8')) as ChatRecord
        const { id, title, provider, updatedAt } = record
        return { id, title, documentPath: record.documentPath ?? null, provider, updatedAt, tabId: record.tabId }
      } catch {
        return null
      }
    })
  )
  return chats
    .filter((chat): chat is ChatSummary & { tabId: string | undefined } => chat !== null && (documentPath === undefined || (chat.documentPath === documentPath && (documentPath !== null || chat.tabId === tabId))))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ tabId: _tabId, ...summary }) => summary)
}

export async function getChat(id: string): Promise<ChatRecord | null> {
  try {
    return JSON.parse(await readFile(fileFor(id), 'utf8')) as ChatRecord
  } catch {
    return null
  }
}

export async function saveChat(record: ChatRecord): Promise<void> {
  await mkdir(directory(), { recursive: true })
  await writeFile(fileFor(record.id), JSON.stringify(record), 'utf8')
}

export async function deleteChat(id: string): Promise<void> {
  await rm(fileFor(id), { force: true })
}
