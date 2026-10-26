import { useEffect, useRef, useState } from 'react'
import { PROVIDERS, type ChatSummary } from '../../shared/agent'
import { useListNavigation, usePopover } from './Popover'

const PROVIDER_MARKS: Record<string, string> = { claude: 'C', codex: 'X', gemini: 'G' }

export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ChatPicker({
  title,
  currentId,
  documentPath,
  disabled,
  onOpen,
  onDelete,
}: {
  title: string
  currentId: string | null
  documentPath: string | null
  disabled: boolean
  onOpen: (id: string) => void
  onDelete: () => void
}): React.ReactElement {
  const popover = usePopover()
  const [scope, setScope] = useState<'document' | 'all'>('document')
  const [query, setQuery] = useState('')
  const [chats, setChats] = useState<ChatSummary[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLowerCase()
  const matches = chats.filter((chat) => !needle || chat.title.toLowerCase().includes(needle))
  const list = useListNavigation(matches.length, popover.open)

  useEffect(() => {
    if (!popover.open) return
    setQuery('')
    inputRef.current?.focus()
    void window.suikopen.listChats(scope === 'document' ? documentPath : undefined).then(setChats)
  }, [popover.open, scope, documentPath])

  useEffect(() => {
    document.getElementById(`${popover.id}-${list.active}`)?.scrollIntoView({ block: 'nearest' })
  }, [list.active, popover.id])

  function choose(index: number): void {
    const chat = matches[index]
    if (chat) {
      popover.close()
      onOpen(chat.id)
    }
  }

  return (
    <div className="picker chat-picker" ref={popover.rootRef}>
      <button
        ref={popover.triggerRef}
        className="chat-trigger"
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        aria-controls={popover.id}
        aria-label={`Chat: ${title}. Show chat history`}
        disabled={disabled}
        onClick={() => popover.setOpen(!popover.open)}
      >
        <span className="chat-trigger-title">{title}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {popover.open ? (
        <div className="popover popover-down">
          <input
            ref={inputRef}
            className="popover-search"
            placeholder="Search chats"
            aria-label="Search chats"
            role="combobox"
            aria-expanded="true"
            aria-controls={popover.id}
            aria-activedescendant={matches.length ? `${popover.id}-${list.active}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => list.onKey(event, choose, popover.close)}
          />
          <div className="segmented chat-scope" role="radiogroup" aria-label="Show chats from">
            {(['document', 'all'] as const).map((value) => (
              <button key={value} role="radio" aria-checked={scope === value} className={scope === value ? 'active' : ''} onClick={() => setScope(value)}>
                {value === 'document' ? 'This document' : 'All chats'}
              </button>
            ))}
          </div>
          <div id={popover.id} role="listbox" aria-label="Chats" className="popover-scroll">
            {matches.length === 0 ? <div className="popover-empty">{chats.length ? 'No chats match.' : 'No chats yet.'}</div> : null}
            {matches.map((chat, index) => {
              const provider = PROVIDERS.find((entry) => entry.id === chat.provider)?.name ?? chat.provider
              return (
                <div
                  key={chat.id}
                  id={`${popover.id}-${index}`}
                  role="option"
                  aria-selected={chat.id === currentId}
                  aria-label={`${chat.title}, ${provider}, ${relativeTime(chat.updatedAt)}`}
                  className={`popover-row popover-option${index === list.active ? ' active' : ''}`}
                  onPointerMove={() => list.setActive(index)}
                  onClick={() => choose(index)}
                >
                  <span className="popover-check">{chat.id === currentId ? '●' : ''}</span>
                  <span className="popover-name chat-row-title">{chat.title}</span>
                  <span className="popover-hint">{relativeTime(chat.updatedAt)}</span>
                  <span className="chat-provider" title={provider} aria-hidden="true">
                    {PROVIDER_MARKS[chat.provider] ?? '?'}
                  </span>
                </div>
              )
            })}
          </div>
          {currentId ? (
            <>
              <div className="popover-divider" />
              <button
                className="popover-row popover-option popover-radio chat-delete"
                onClick={() => {
                  popover.close()
                  onDelete()
                }}
              >
                <span className="popover-check" />
                Delete this chat
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
