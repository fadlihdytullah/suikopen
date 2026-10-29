import type { HistorySnapshot } from '../store/history'
import { forgetResolved } from '../document/resolved'
import type { Tab, TabsStore } from './tabs-store'

export const SLEEP_AFTER_MS = 10 * 60 * 1000

export type HistoryVault = {
  spill: (id: string, json: string) => Promise<void>
  take: (id: string) => Promise<string | null>
}

export async function sleepTab(tab: Tab, vault: HistoryVault): Promise<boolean> {
  const history = tab.store.history
  if (tab.asleep || tab.presence.state().working || history.isOpen()) {
    return false
  }
  const snapshot = history.snapshot()
  if (snapshot.past.length + snapshot.future.length > 0) {
    await vault.spill(tab.id, JSON.stringify(snapshot))
    if (history.isOpen() || history.depth().past !== snapshot.past.length || history.depth().future !== snapshot.future.length) {
      await vault.take(tab.id)
      return false
    }
    history.clear()
  }
  forgetResolved(tab.store.getState())
  tab.asleep = true
  return true
}

export async function wakeTab(tab: Tab, vault: HistoryVault): Promise<void> {
  if (!tab.asleep) {
    return
  }
  tab.asleep = false
  const json = await vault.take(tab.id)
  if (json) {
    tab.store.history.restore(JSON.parse(json) as HistorySnapshot)
  }
}

export async function sleepIdleTabs(tabs: TabsStore, vault: HistoryVault, now: number, after = SLEEP_AFTER_MS): Promise<string[]> {
  const slept: string[] = []
  const { tabs: list, activeId } = tabs.getState()
  for (const tab of list) {
    if (tab.id !== activeId && tab.inactiveSince > 0 && now - tab.inactiveSince >= after && (await sleepTab(tab, vault))) {
      slept.push(tab.id)
    }
  }
  return slept
}
