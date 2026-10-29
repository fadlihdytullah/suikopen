import { useEffect, useState } from 'react'
import { Stage } from './canvas/Stage'
import { useInitialDocument } from './document/use-document'
import { DocumentStoreProvider, SelectionStoreProvider } from './store/use-store'
import { LeftPanel, RightPanel, usePanelCommands } from './ui/Panels'
import { SettingsDialog } from './ui/SettingsDialog'
import { createEditCommands } from './tools/commands'
import { TextEditor } from './tools/TextEditor'
import { Toolbar, ZoomControl } from './tools/Toolbar'
import { tabs, useActiveTab, type Tab } from './tabs/tabs-store'
import { newTab, openDialog, useTabsSession } from './tabs/session'
import { TabBar } from './tabs/TabBar'

const message: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  color: '#e6e7ea',
  font: '14px ui-sans-serif, system-ui, sans-serif',
  whiteSpace: 'pre-wrap',
  padding: 32,
  textAlign: 'center',
}

function Workspace({ tab }: { tab: Tab }): React.ReactElement {
  usePanelCommands()

  useEffect(() => createEditCommands(tab.store, tab.selection), [tab])

  return (
    <DocumentStoreProvider value={tab.store}>
      <SelectionStoreProvider value={tab.selection}>
        <div className="shell" id="doc-panel" role="tabpanel" aria-labelledby={`doc-tab-${tab.id}`}>
          <LeftPanel tabId={tab.id} />
          <main className="canvas-area" aria-label="Canvas">
            <Stage key={`stage-${tab.id}`} tab={tab} />
            <TextEditor key={`text-${tab.id}`} />
            <Toolbar />
            <ZoomControl />
          </main>
          <RightPanel tabId={tab.id} />
        </div>
        <SettingsDialog />
      </SelectionStoreProvider>
    </DocumentStoreProvider>
  )
}

function Tabs(): React.ReactElement {
  useTabsSession()
  const tab = useActiveTab()
  return (
    <div className="app">
      <TabBar />
      {tab ? (
        <Workspace tab={tab} />
      ) : (
        <div className="empty-workspace" id="doc-panel" role="tabpanel" aria-label="No document open">
          <p>No document open</p>
          <div>
            <button type="button" onClick={() => void newTab()}>New file <kbd>⌘N</kbd></button>
            <button type="button" onClick={() => void openDialog()}>Open… <kbd>⌘O</kbd></button>
          </div>
        </div>
      )}
    </div>
  )
}

export function App(): React.ReactElement {
  const initial = useInitialDocument()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (initial.status !== 'ready' || ready) {
      return
    }
    for (const opened of initial.opened) {
      tabs.open({ id: opened.tabId, document: opened.document, path: opened.path, assetBase: opened.assetBase, recovered: opened.recovered })
    }
    if (initial.activeTabId) {
      tabs.activate(initial.activeTabId)
    }
    setReady(true)
  }, [initial, ready])

  if (initial.status === 'failed') {
    return <div style={{ ...message, color: '#e4606d' }}>{initial.error}</div>
  }

  if (!ready) {
    return <div style={message}>Opening document…</div>
  }

  return <Tabs />
}
