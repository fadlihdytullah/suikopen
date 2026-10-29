import type { ChatEntry } from '../../shared/agent'
import { buildHandoff, changedIds, type ChangedNode } from '../../shared/handoff'
import { resolvedDocument } from '../document/current'
import { parentChain, sceneItems } from '../canvas/scene-index'
import { tabLabels, tabs, type Tab } from '../tabs/tabs-store'

export function handoffFor(tab: Tab, chat: { entries: readonly ChatEntry[]; handoff?: string | null } | null): string {
  const entries = chat?.entries ?? []
  const items = sceneItems(resolvedDocument(tab.store))
  const byId = new Map(items.map((item) => [item.node.id, item]))
  const changed: ChangedNode[] = []
  const missing: string[] = []
  for (const id of changedIds(entries)) {
    const item = byId.get(id)
    if (!item) {
      missing.push(id)
      continue
    }
    const top = byId.get(parentChain(items, id).at(-1) ?? id) ?? item
    changed.push({ id, name: item.node.name ?? item.node.type, type: item.node.type, screen: { id: top.node.id, name: top.node.name ?? top.node.type } })
  }
  return buildHandoff({
    tab: { id: tab.id, name: tabLabels(tabs.getState().tabs).get(tab.id) ?? tab.id },
    path: tab.path,
    entries,
    summary: chat?.handoff ?? null,
    memory: tab.store.getState().memory ?? [],
    changed,
    missing,
  })
}

export async function latestHandoff(tab: Tab): Promise<string> {
  const id = tab.chatId ?? (await window.suikopen.listChats(tab.path, tab.id))[0]?.id
  const chat = id ? await window.suikopen.getChat(id) : null
  return handoffFor(tab, chat)
}
