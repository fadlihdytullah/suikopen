import { useSyncExternalStore } from 'react'
import { DEFAULT_PROVIDER, PROVIDERS, type AgentProviderId, type AgentProviderStatus } from '../../shared/agent'

const PROVIDER_KEY = 'suikopen.agent.provider'

export type SettingsPage = 'agents' | 'integrations' | 'appearance'

type State = {
  open: boolean
  page: SettingsPage
  provider: AgentProviderId
  statuses: Partial<Record<AgentProviderId, AgentProviderStatus>>
  checking: Partial<Record<AgentProviderId, boolean>>
}

function storedProvider(): AgentProviderId {
  const value = localStorage.getItem(PROVIDER_KEY)
  return PROVIDERS.some((entry) => entry.id === value) ? (value as AgentProviderId) : DEFAULT_PROVIDER
}

let state: State = { open: false, page: 'agents', provider: storedProvider(), statuses: {}, checking: {} }
const listeners = new Set<() => void>()

function set(next: Partial<State>): void {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export const openSettings = (page?: SettingsPage) => set({ open: true, ...(page ? { page } : {}) })
export const showSettingsPage = (page: SettingsPage) => set({ page })
export const closeSettings = () => set({ open: false })
export const toggleSettings = () => set({ open: !state.open })

export function setProvider(provider: AgentProviderId): void {
  localStorage.setItem(PROVIDER_KEY, provider)
  set({ provider })
}

export async function refreshStatus(provider: AgentProviderId): Promise<void> {
  set({ checking: { ...state.checking, [provider]: true } })
  const status = await window.suikopen.agentStatus(provider)
  set({ statuses: { ...state.statuses, [provider]: status }, checking: { ...state.checking, [provider]: false } })
}

export function refreshStatuses(): void {
  for (const entry of PROVIDERS) {
    void refreshStatus(entry.id)
  }
}

export function useSettings(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}
