import { useCallback, useEffect, useRef, useState } from 'react'
import type { Document } from '../shared/schema/document'
import { Stage } from './canvas/Stage'
import { useFileSession, type Replacement } from './document/file-session'
import { useInitialDocument } from './document/use-document'
import { createAgentHandlers } from './mcp/handlers'
import { createDocumentStore } from './store/document-store'
import { createMutationQueue } from './store/mutation-queue'
import { createSelectionStore } from './store/selection'
import { DocumentStoreProvider, SelectionStoreProvider } from './store/use-store'
import { LeftPanel, RightPanel, usePanelCommands } from './ui/Panels'
import { SettingsDialog } from './ui/SettingsDialog'
import { createEditCommands } from './tools/commands'
import { TextEditor } from './tools/TextEditor'
import { setDocumentPath } from './document/current-path'
import { Toolbar } from './tools/Toolbar'

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

function Editor({
  document,
  path,
  assetBase,
  onReplace,
}: {
  document: Document
  path: string | null
  assetBase: string | null
  onReplace: (replacement: Replacement) => void
}): React.ReactElement {
  const [store] = useState(() => createDocumentStore(document))
  const [selection] = useState(() => createSelectionStore())
  const [queue] = useState(() => createMutationQueue(store))

  usePanelCommands()
  const session = useFileSession(store, selection, path, assetBase, onReplace)
  const pathRef = useRef(session.path)
  pathRef.current = session.path
  useEffect(() => setDocumentPath(session.path), [session.path])

  useEffect(() => createEditCommands(store, selection), [store, selection])

  useEffect(() => {
    const handle = createAgentHandlers({ store, selection, queue, documentPath: () => pathRef.current })
    const off = window.suikopen.onAgentCall((request) => handle(request))

    return () => {
      off()
      queue.dispose()
    }
  }, [store, selection, queue])

  return (
    <DocumentStoreProvider value={store}>
      <SelectionStoreProvider value={selection}>
        <div className="shell">
          <LeftPanel />
          <main className="canvas-area" aria-label="Canvas">
            <Stage />
            <TextEditor />
            <Toolbar />
          </main>
          <RightPanel />
        </div>
        <SettingsDialog />
      </SelectionStoreProvider>
    </DocumentStoreProvider>
  )
}

export function App(): React.ReactElement {
  const initial = useInitialDocument()
  const [replacement, setReplacement] = useState<(Replacement & { key: number }) | null>(null)
  const onReplace = useCallback(
    (next: Replacement) => setReplacement((current) => ({ ...next, key: (current?.key ?? 0) + 1 })),
    []
  )

  if (replacement) {
    return (
      <Editor
        key={replacement.key}
        document={replacement.document}
        path={replacement.path}
        assetBase={replacement.assetBase}
        onReplace={onReplace}
      />
    )
  }

  if (initial.status === 'loading') {
    return <div style={message}>Opening document…</div>
  }

  if (initial.status === 'failed') {
    return <div style={{ ...message, color: '#e4606d' }}>{initial.error}</div>
  }

  return (
    <Editor key={0} document={initial.document} path={initial.path} assetBase={initial.assetBase} onReplace={onReplace} />
  )
}
