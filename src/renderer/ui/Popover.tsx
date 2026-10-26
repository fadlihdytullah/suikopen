import { useEffect, useId, useRef, useState } from 'react'

export function usePopover() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return { open, setOpen, close, rootRef, triggerRef, id }
}

export function useListNavigation(count: number, open: boolean) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (open) {
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, count - 1)))
  }, [count])

  function onKey(event: React.KeyboardEvent, choose: (index: number) => void, close: () => void): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (count ? (current + 1) % count : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (count ? (current - 1 + count) % count : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (count) {
        choose(active)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return { active, setActive, onKey }
}
