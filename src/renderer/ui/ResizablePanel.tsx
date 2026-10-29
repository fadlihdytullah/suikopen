import { useEffect, useRef, useState } from 'react'
import { setPanelInset } from './panel-state'

export function ResizablePanel({
  side,
  storageKey,
  min,
  max,
  initial,
  label,
  hidden,
  children,
}: {
  side: 'left' | 'right'
  storageKey: string
  min: number
  max: number
  initial: number
  label: string
  hidden?: boolean
  children: React.ReactNode
}): React.ReactElement {
  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)))
  const [width, setWidth] = useState(() => clamp(Number(localStorage.getItem(storageKey)) || initial))
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const direction = side === 'left' ? 1 : -1

  useEffect(() => {
    setPanelInset(side, hidden ? 0 : width)
  }, [side, width, hidden])

  useEffect(() => () => setPanelInset(side, 0), [side])

  function commit(next: number): void {
    const value = clamp(next)
    setWidth(value)
    localStorage.setItem(storageKey, String(value))
  }

  return (
    <aside className={`panel panel-${side}`} style={{ width }} hidden={hidden} aria-label={label}>
      <div
        className="panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label.toLowerCase()}`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { startX: event.clientX, startWidth: width }
          document.body.classList.add('resizing')
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag) {
            setWidth(clamp(drag.startWidth + (event.clientX - drag.startX) * direction))
          }
        }}
        onPointerUp={() => {
          dragRef.current = null
          document.body.classList.remove('resizing')
          commit(width)
        }}
        onDoubleClick={() => commit(initial)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 10
          const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
          const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
          if (event.key === grow || event.key === shrink || event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            event.stopPropagation()
          }
          if (event.key === grow) {
            commit(width + step)
          } else if (event.key === shrink) {
            commit(width - step)
          } else if (event.key === 'Home') {
            commit(max)
          } else if (event.key === 'End') {
            commit(min)
          }
        }}
      />
      {children}
    </aside>
  )
}
