import { useEffect, useReducer, useRef, useState } from 'react'
import { itemById, nodeById } from '../canvas/scene-index'
import { currentViewport, onViewportChange } from '../canvas/viewport-ref'
import { toScreen } from '../canvas/viewport'
import { resolvedDocument } from '../document/current'
import { removeNodes, setNodeProps } from '../store/mutations'
import { useDocumentStore, useSelectionStore } from '../store/use-store'
import { DEFAULT_FAMILY } from '../text/font-manager'
import { stopTextEdit, useToolState } from './tool-state'

function Field({ id, gestureOpen }: { id: string; gestureOpen: boolean }): React.ReactElement | null {
  const store = useDocumentStore()
  const selection = useSelectionStore()
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const raw = nodeById(store.getState(), id)
  const [value, setValue] = useState(raw?.type === 'text' ? raw.content : '')
  const valueRef = useRef(value)
  valueRef.current = value

  function finish(): void {
    if (done.current) return
    done.current = true
    if (!valueRef.current.trim()) {
      removeNodes(store, new Set([id]))
      selection.clear()
    }
    store.endGesture()
    stopTextEdit()
  }

  useEffect(() => {
    if (!gestureOpen) store.beginGesture('Edit text')
    ref.current?.focus()
    ref.current?.select()
    const off = onViewportChange(rerender)
    return () => {
      off()
      finish()
    }
  }, [])

  const item = itemById(resolvedDocument(store), id)
  if (!item || item.node.type !== 'text') return null
  const node = item.node
  const { viewport } = currentViewport()
  const topLeft = toScreen(viewport, { x: item.x, y: item.y })
  const fontSize = (typeof node.fontSize === 'number' ? node.fontSize : 16) * viewport.scale
  const hug = node.width === 'fit_content'

  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label="Edit text"
      spellCheck={false}
      value={value}
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: hug ? Math.max(item.width * viewport.scale, fontSize) + 2 : item.width * viewport.scale,
        height: Math.max(item.height * viewport.scale, fontSize * (node.lineHeight ?? 1.2)),
        fontFamily: `"${node.fontFamily ?? DEFAULT_FAMILY}"`,
        fontSize,
        fontWeight: node.fontWeight ?? 400,
        fontStyle: node.fontStyle ?? 'normal',
        lineHeight: node.lineHeight ?? 1.2,
        letterSpacing: (node.letterSpacing ?? 0) * viewport.scale,
        textAlign: node.textAlign ?? 'left',
        whiteSpace: hug ? 'pre' : 'pre-wrap',
      }}
      onChange={(event) => {
        setValue(event.target.value)
        setNodeProps(store, 'Edit text', [id], { content: event.target.value })
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
          event.preventDefault()
          finish()
        }
      }}
    />
  )
}

export function TextEditor(): React.ReactElement | null {
  const { editingText, gestureOpen } = useToolState()
  return editingText ? <Field key={editingText} id={editingText} gestureOpen={gestureOpen} /> : null
}
