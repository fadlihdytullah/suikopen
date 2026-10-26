import { useRef } from 'react'
import { setTool, useToolState, type Tool } from './tool-state'

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: 'move', label: 'Move', key: 'V', icon: <path d="M4 3l9 4.2-4 1.2-1.4 4.1z" strokeLinejoin="round" /> },
  { tool: 'frame', label: 'Frame', key: 'F', icon: <path d="M6 2.5v13M12 2.5v13M2.5 6h13M2.5 12h13" /> },
  { tool: 'rectangle', label: 'Rectangle', key: 'R', icon: <rect x="3.5" y="3.5" width="11" height="11" rx="1.5" /> },
  { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: <circle cx="9" cy="9" r="5.75" /> },
  { tool: 'text', label: 'Text', key: 'T', icon: <path d="M4 4.5h10M9 4.5v9.5" /> },
  { tool: 'hand', label: 'Hand', key: 'H', icon: <path d="M6 9V4.75a1.25 1.25 0 0 1 2.5 0V8.5M8.5 8V3.75a1.25 1.25 0 0 1 2.5 0V8.5M11 8.5V5a1.25 1.25 0 0 1 2.5 0v5.5a4.5 4.5 0 0 1-8.2 2.6L3.6 10.4a1.2 1.2 0 0 1 1.9-1.5L6 9.6" strokeLinejoin="round" /> },
]

export function Toolbar(): React.ReactElement {
  const { tool } = useToolState()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const activeIndex = TOOLS.findIndex((entry) => entry.tool === tool)

  function onKeyDown(event: React.KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    event.stopPropagation()
    refs.current[(index + step + TOOLS.length) % TOOLS.length]?.focus()
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOLS.map((entry, index) => (
        <button
          key={entry.tool}
          ref={(element) => {
            refs.current[index] = element
          }}
          className={`tool${entry.tool === tool ? ' active' : ''}`}
          aria-label={entry.label}
          aria-pressed={entry.tool === tool}
          aria-keyshortcuts={entry.key}
          data-tip={`${entry.label}  ${entry.key}`}
          tabIndex={index === activeIndex ? 0 : -1}
          onClick={() => setTool(entry.tool)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            {entry.icon}
          </svg>
        </button>
      ))}
    </div>
  )
}
