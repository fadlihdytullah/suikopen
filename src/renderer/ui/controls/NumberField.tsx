import { useEffect, useRef, useState } from 'react'

export type NumberFieldProps = {
  label: React.ReactNode
  title?: string
  value: number | null
  mixed?: boolean
  step?: number
  min?: number
  max?: number
  display?: string
  disabled?: boolean
  onCommit: (value: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
}

export function NumberField({
  label,
  title,
  value,
  mixed,
  step = 1,
  min,
  max,
  display,
  disabled,
  onCommit,
  onScrubStart,
  onScrubEnd,
}: NumberFieldProps): React.ReactElement {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const scrub = useRef<{ startX: number; start: number } | null>(null)

  useEffect(() => {
    if (!editing) {
      setDraft(display ?? (mixed ? '' : value === null ? '' : String(Math.round(value * 100) / 100)))
    }
  }, [value, mixed, editing, display])

  function clamp(next: number): number {
    return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next))
  }

  function commit(next: number): void {
    if (Number.isFinite(next)) {
      onCommit(clamp(next))
    }
  }

  return (
    <label className={`field${disabled ? ' disabled' : ''}`} title={title}>
      <span
        className="field-label"
        onPointerDown={(event) => {
          if (disabled) return
          scrub.current = { startX: event.clientX, start: value ?? 0 }
          event.currentTarget.setPointerCapture(event.pointerId)
          onScrubStart?.()
        }}
        onPointerMove={(event) => {
          const active = scrub.current
          if (active) {
            commit(Math.round(active.start + (event.clientX - active.startX) * step))
          }
        }}
        onPointerUp={() => {
          if (scrub.current) {
            scrub.current = null
            onScrubEnd?.()
          }
        }}
      >
        {label}
      </span>
      <input
        className="field-input"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        placeholder={mixed ? 'Mixed' : ''}
        aria-label={title ?? (typeof label === 'string' ? label : undefined)}
        onFocus={(event) => {
          setEditing(true)
          event.currentTarget.select()
        }}
        onBlur={() => {
          setEditing(false)
          if (draft !== '' && draft !== display) {
            commit(Number(draft))
          }
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setDraft(display ?? (value === null ? '' : String(value)))
            setEditing(false)
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const base = Number(draft) || value || 0
            const next = clamp(base + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : step))
            setDraft(String(next))
            onCommit(next)
          }
        }}
      />
    </label>
  )
}
