import type { AgentReply, AgentRequest, TabListing } from '../../shared/mcp/contract'
import { activeTheme, setActiveTheme } from '../document/resolved'
import { createAgentHandlers } from '../mcp/handlers'
import { latestHandoff } from '../agent/handoff'
import { isDirty, tabLabels, type Tab, type TabsStore } from './tabs-store'

type Handle = (request: AgentRequest) => Promise<unknown>

export function createTabRouter(tabs: TabsStore, beforeCall: (tab: Tab) => Promise<void> = async () => {}) {
  const handlers = new WeakMap<Tab, Handle>()

  function isActive(tab: Tab): boolean {
    return tabs.getState().activeId === tab.id
  }

  function handlerFor(tab: Tab): Handle {
    let handle = handlers.get(tab)
    if (!handle) {
      handle = createAgentHandlers({
        store: tab.store,
        selection: tab.selection,
        queue: tab.queue,
        presence: tab.presence,
        documentPath: () => tab.path,
        theme: {
          get: () => (isActive(tab) ? activeTheme() : tab.theme),
          set: (next) => {
            tab.theme = next
            if (isActive(tab)) {
              setActiveTheme(next)
            }
          },
        },
        visible: () => isActive(tab),
      })
      handlers.set(tab, handle)
    }
    return handle
  }

  function list(): TabListing[] {
    const { tabs: open, activeId } = tabs.getState()
    const labels = tabLabels(open)
    return open.map((tab) => ({
      id: tab.id,
      name: labels.get(tab.id) ?? tab.id,
      path: tab.path,
      active: tab.id === activeId,
      dirty: isDirty(tab),
      agentBusy: tab.presence.state().working,
    }))
  }

  return async function route(request: AgentRequest): Promise<AgentReply> {
    if (request.method === 'list_tabs') {
      return { value: list() }
    }

    const tab = request.tabId ? tabs.get(request.tabId) : tabs.active()
    if (!tab) {
      throw new Error(
        request.tabId
          ? `Tab "${request.tabId}" is closed. Call list_tabs to see open tabs.`
          : 'No document is open. Ask the user to open or create one.'
      )
    }

    const ref = { id: tab.id, name: tabLabels(tabs.getState().tabs).get(tab.id) ?? tab.id }
    if (request.method === 'tab_info') {
      return { value: { ...ref, active: isActive(tab) }, tab: ref }
    }

    if (request.method === 'get_handoff') {
      return { value: { handoff: await latestHandoff(tab) }, tab: ref }
    }

    await beforeCall(tab)
    return { value: await handlerFor(tab)(request), tab: ref }
  }
}
