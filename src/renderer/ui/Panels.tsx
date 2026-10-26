import { useEffect } from 'react'
import { AgentPanel } from './AgentPanel'
import { Inspector } from './Inspector'
import { LayersPanel } from './LayersPanel'
import { ResizablePanel } from './ResizablePanel'
import { showLeftTab, togglePanels, usePanels, type LeftTab } from './panel-state'
import { toggleSettings } from './settings-state'

export function usePanelCommands(): void {
  useEffect(
    () =>
      window.suikopen.onMenuCommand((command) => {
        if (command === 'toggle-panels') togglePanels()
        if (command === 'show-layers') showLeftTab('layers')
        if (command === 'show-agent') showLeftTab('agent')
        if (command === 'open-settings') toggleSettings()
      }),
    []
  )
}

const TABS: { id: LeftTab; label: string; icon: React.ReactNode }[] = [
  { id: 'layers', label: 'Layers', icon: <path d="M8 2.5 14 5.5 8 8.5 2 5.5zM2 8.25l6 3 6-3M2 11l6 3 6-3" /> },
  { id: 'agent', label: 'Agent', icon: <path d="M3 12.5V4.75A1.75 1.75 0 0 1 4.75 3h6.5A1.75 1.75 0 0 1 13 4.75v4.5A1.75 1.75 0 0 1 11.25 11H5.5z" /> },
]

export function LeftPanel(): React.ReactElement {
  const { leftTab, hidden } = usePanels()

  return (
    <ResizablePanel side="left" storageKey="suikopen.panel.left" min={260} max={560} initial={320} label="Layers and agent" hidden={hidden}>
      <nav className="panel-tabs" role="tablist" aria-label="Left panel">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            role="tab"
            id={`left-tab-${tab.id}`}
            aria-selected={leftTab === tab.id}
            aria-controls={`left-body-${tab.id}`}
            aria-label={tab.label}
            className={leftTab === tab.id ? 'active' : ''}
            title={`${tab.label}  ⌥${index + 1}`}
            onClick={() => showLeftTab(tab.id)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {tab.icon}
            </svg>
            {leftTab === tab.id ? <span>{tab.label}</span> : null}
          </button>
        ))}
      </nav>
      <div className="panel-body" id="left-body-layers" role="tabpanel" aria-labelledby="left-tab-layers" hidden={leftTab !== 'layers'}>
        <LayersPanel />
      </div>
      <div className="panel-body" id="left-body-agent" role="tabpanel" aria-labelledby="left-tab-agent" hidden={leftTab !== 'agent'}>
        <AgentPanel />
      </div>
    </ResizablePanel>
  )
}

export function RightPanel(): React.ReactElement {
  const { hidden } = usePanels()

  return (
    <ResizablePanel side="right" storageKey="suikopen.panel.right" min={280} max={480} initial={320} label="Properties" hidden={hidden}>
      <div className="panel-body">
        <Inspector />
      </div>
    </ResizablePanel>
  )
}
