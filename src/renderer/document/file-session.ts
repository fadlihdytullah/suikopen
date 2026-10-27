import { useEffect, useRef, useState } from 'react'
import type { Document } from '../../shared/schema/document'
import { sceneItems } from '../canvas/scene-index'
import { setAssetBase } from '../canvas/image-cache'
import type { DocumentStore } from '../store/document-store'
import { removeNodes } from '../store/mutations'
import type { SelectionStore } from '../store/selection'

const AUTOSAVE_DELAY_MS = 800

export type Replacement = { document: Document; path: string | null; assetBase: string | null }

export function useFileSession(
  store: DocumentStore,
  selection: SelectionStore,
  initialPath: string | null,
  assetBase: string | null,
  onReplace: (replacement: Replacement) => void
): { path: string | null; dirty: boolean } {
  const [path, setPath] = useState(initialPath)
  const [dirty, setDirty] = useState(false)
  const savedRef = useRef<Document>(store.getState())
  const pathRef = useRef(path)
  pathRef.current = path

  useEffect(() => {
    async function save(saveAs = false): Promise<boolean> {
      const document = store.getState()
      const result = await window.suikopen.saveDocument({ path: pathRef.current, document, saveAs })

      if ('cancelled' in result) {
        return false
      }

      if (!result.ok) {
        return false
      }

      savedRef.current = document
      setPath(result.path)
      setDirty(store.getState() !== document)
      return true
    }

    async function confirmReplace(): Promise<boolean> {
      if (store.getState() === savedRef.current) {
        return true
      }
      const choice = await window.suikopen.confirmDiscard()
      if (choice === 'cancel') {
        return false
      }
      return choice === 'discard' || (await save())
    }

    async function open(): Promise<void> {
      if (!(await confirmReplace())) {
        return
      }
      const result = await window.suikopen.openDocumentDialog()
      if ('cancelled' in result || !result.ok) {
        return
      }
      onReplace({ document: result.document, path: result.path, assetBase: result.assetBase })
    }

    const refresh = (): void => setDirty(store.getState() !== savedRef.current)

    let timer: ReturnType<typeof setTimeout> | undefined

    const unsubscribe = store.subscribe(() => {
      refresh()

      if (!pathRef.current) {
        return
      }

      clearTimeout(timer)
      timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
    })

    const offMenu = window.suikopen.onMenuCommand((command) => {
      const focused = window.document.activeElement as HTMLElement | null
      const editingText =
        !!focused && (focused.isContentEditable || ['INPUT', 'TEXTAREA'].includes(focused.tagName))

      if (editingText && (command === 'undo' || command === 'redo' || command === 'select-all')) {
        window.document.execCommand(command === 'select-all' ? 'selectAll' : command)
        return
      }

      switch (command) {
        case 'new':
          void confirmReplace().then((ok) => {
            if (ok) {
              onReplace({ document: { version: 1, children: [] }, path: null, assetBase: null })
            }
          })
          break
        case 'open':
          void open()
          break
        case 'save':
          void save()
          break
        case 'save-as':
          void save(true)
          break
        case 'undo':
          store.undo()
          break
        case 'redo':
          store.redo()
          break
        case 'select-all':
          selection.set(sceneItems(store.getState()).map((item) => item.node.id))
          break
        case 'delete':
          removeNodes(store, selection.getState())
          selection.clear()
          break
      }
    })

    const offOpened = window.suikopen.onDocumentOpened((result) => {
      if (!result.ok) {
        return
      }
      void confirmReplace().then((ok) => {
        if (ok) {
          onReplace({ document: result.document, path: result.path, assetBase: result.assetBase })
        }
      })
    })

    const offClose = window.suikopen.onCloseRequest(() => {
      void (async () => {
        if (await confirmReplace()) {
          window.suikopen.allowClose()
        }
      })()
    })

    return () => {
      clearTimeout(timer)
      unsubscribe()
      offMenu()
      offOpened()
      offClose()
    }
  }, [store, selection, onReplace])

  useEffect(() => {
    setAssetBase(path ?? assetBase)
  }, [path, assetBase])

  useEffect(() => {
    void window.suikopen.setWindowState({ path, edited: dirty })
  }, [path, dirty])

  return { path, dirty }
}
