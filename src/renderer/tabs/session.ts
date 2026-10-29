import { useEffect } from 'react'
import type { OpenResult } from '../../main/ipc'
import { sceneItems } from '../canvas/scene-index'
import { setAssetBase } from '../canvas/image-cache'
import { removeNodes } from '../store/mutations'
import { isDirty, isPristine, tabName, tabs, type Tab, type TabInput } from './tabs-store'
import { createTabRouter } from './router'
import { sleepIdleTabs, wakeTab, type HistoryVault } from './sleep'

const AUTOSAVE_DELAY_MS = 800
const SLEEP_CHECK_MS = 60 * 1000

const vault: HistoryVault = {
  spill: (id, json) => window.suikopen.spillHistory(id, json),
  take: (id) => window.suikopen.takeHistory(id),
}
const CHECKPOINT_DELAY_MS = 1000

async function save(tab: Tab, saveAs = false): Promise<boolean> {
  const document = tab.store.getState()
  const result = await window.suikopen.saveDocument({ tabId: tab.id, path: tab.path, document, saveAs })
  if ('cancelled' in result || !result.ok) {
    return false
  }
  tabs.markSaved(tab.id, document, result.path)
  return true
}

async function confirmClose(tab: Tab): Promise<boolean> {
  if (!isDirty(tab)) {
    return true
  }
  tabs.activate(tab.id)
  const choice = await window.suikopen.confirmDiscard(tabName(tab))
  if (choice === 'cancel') {
    return false
  }
  return choice === 'discard' || (await save(tab))
}

export async function closeTab(id: string): Promise<void> {
  const tab = tabs.get(id)
  if (!tab) {
    return
  }
  if (tab.presence.state().working) {
    if (!(await window.suikopen.confirmStopAgent(tabName(tab)))) {
      return
    }
    await window.suikopen.stopAgent()
  }
  if (!(await confirmClose(tab))) {
    return
  }
  tabs.close(id)
  window.suikopen.tabClosed(id)
}

export async function newTab(): Promise<void> {
  const id = await window.suikopen.newTabId()
  place({ id, document: { version: 1, children: [] }, path: null, assetBase: null })
}

export async function openDialog(): Promise<void> {
  const result = await window.suikopen.openDocumentDialog()
  if (!('cancelled' in result)) {
    placeOpened(result)
  }
}

function place(input: TabInput): void {
  const active = tabs.active()
  if (active && isPristine(active) && !active.presence.state().working) {
    window.suikopen.tabClosed(active.id)
    tabs.replace(active.id, input)
  } else {
    tabs.open(input)
  }
}

function placeOpened(result: OpenResult): void {
  if (!result.ok) {
    return
  }
  if (result.existing) {
    tabs.activate(result.tabId)
    return
  }
  place({ id: result.tabId, document: result.document, path: result.path, assetBase: result.assetBase, recovered: result.recovered })
}

export function useTabsSession(): void {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const checkpointTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const savedState = new Map<string, boolean>()
    const watched = new Map<string, () => void>()

    function watch(): void {
      const open = new Set(tabs.getState().tabs.map((tab) => tab.id))
      for (const [id, off] of watched) {
        if (!open.has(id)) {
          off()
          clearTimeout(timers.get(id))
          timers.delete(id)
          clearTimeout(checkpointTimers.get(id))
          checkpointTimers.delete(id)
          watched.delete(id)
        }
      }
      for (const tab of tabs.getState().tabs) {
        if (watched.has(tab.id)) {
          continue
        }
        checkpoint(tab)
        watched.set(
          tab.id,
          tab.store.subscribe(() => {
            clearTimeout(checkpointTimers.get(tab.id))
            checkpointTimers.set(tab.id, setTimeout(() => checkpoint(tab), CHECKPOINT_DELAY_MS))
            if (!tab.path) {
              return
            }
            clearTimeout(timers.get(tab.id))
            timers.set(tab.id, setTimeout(() => void save(tab), AUTOSAVE_DELAY_MS))
          })
        )
      }
    }

    function checkpoint(tab: Tab): void {
      window.suikopen.checkpoint({
        tabId: tab.id,
        document: tab.store.getState(),
        path: tab.path,
        assetBase: tab.path ?? tab.assetBase,
        dirty: isDirty(tab),
      })
      savedState.set(tab.id, isDirty(tab))
    }

    function sync(): void {
      const { tabs: list, activeId } = tabs.getState()
      const active = tabs.active()
      if (active?.asleep) {
        void wakeTab(active, vault)
      }
      watch()
      for (const tab of list) {
        if (tabs.get(tab.id) && savedState.get(tab.id) !== isDirty(tab)) {
          checkpoint(tab)
        }
      }
      setAssetBase(active ? (active.path ?? active.assetBase) : null)
      void window.suikopen.setWindowState({ path: active?.path ?? null, edited: list.some(isDirty) })
      window.suikopen.syncTabs(list.map((tab) => ({ id: tab.id, name: tabName(tab), active: tab.id === activeId })))
    }

    const offTabs = tabs.subscribe(sync)
    sync()

    const offMenu = window.suikopen.onMenuCommand((command) => {
      const tab = tabs.active()
      const focused = window.document.activeElement as HTMLElement | null
      const editingText = !!focused && (focused.isContentEditable || ['INPUT', 'TEXTAREA'].includes(focused.tagName))

      if (editingText && (command === 'undo' || command === 'redo' || command === 'select-all')) {
        window.document.execCommand(command === 'select-all' ? 'selectAll' : command)
        return
      }

      switch (command) {
        case 'new':
          void newTab()
          break
        case 'open':
          void openDialog()
          break
        case 'close-tab':
          if (tab) {
            void closeTab(tab.id)
          }
          break
        case 'next-tab':
          tabs.cycle(1)
          break
        case 'previous-tab':
          tabs.cycle(-1)
          break
      }

      if (!tab) {
        return
      }

      switch (command) {
        case 'save':
          void save(tab)
          break
        case 'save-as':
          void save(tab, true)
          break
        case 'undo':
          tab.store.undo()
          break
        case 'redo':
          tab.store.redo()
          break
        case 'select-all':
          tab.selection.set(sceneItems(tab.store.getState()).map((item) => item.node.id))
          break
        case 'delete':
          removeNodes(tab.store, tab.selection.getState())
          tab.selection.clear()
          break
      }
    })

    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || !/^Digit[1-9]$/.test(event.code)) {
        return
      }
      const list = tabs.getState().tabs
      const digit = Number(event.code.slice(5))
      const target = digit === 9 ? list[list.length - 1] : list[digit - 1]
      if (target) {
        event.preventDefault()
        tabs.activate(target.id)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)

    const offAgent = window.suikopen.onAgentCall(createTabRouter(tabs, (tab) => wakeTab(tab, vault)))
    const sleepTimer = setInterval(() => void sleepIdleTabs(tabs, vault, performance.now()), SLEEP_CHECK_MS)
    const offOpened = window.suikopen.onDocumentOpened(placeOpened)
    const offActivate = window.suikopen.onTabActivate((id) => tabs.activate(id))

    const offClose = window.suikopen.onCloseRequest(() => {
      void (async () => {
        for (const tab of tabs.getState().tabs) {
          if (!(await confirmClose(tab))) {
            return
          }
        }
        window.suikopen.allowClose()
      })()
    })

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      clearInterval(sleepTimer)
      offTabs()
      offAgent()
      offMenu()
      offOpened()
      offActivate()
      offClose()
      for (const timer of checkpointTimers.values()) clearTimeout(timer)
      for (const off of watched.values()) off()
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])
}
