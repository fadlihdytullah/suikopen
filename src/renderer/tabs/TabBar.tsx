import { useEffect, useReducer, useRef, useState } from 'react'
import { usePopover, useListNavigation } from '../ui/Popover'
import { closeTab, newTab } from './session'
import { isDirty, middleEllipsis, tabLabels, tabs, useTabs, type Tab } from './tabs-store'

function useAgentActivity(list: readonly Tab[]): void {
  const [, rerender] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const offs = list.map((tab) => tab.presence.subscribe(rerender))
    return () => offs.forEach((off) => off())
  }, [list])
}

function busy(tab: Tab): boolean {
  return tab.presence.state().working || tab.presence.recentlyTouched(performance.now())
}

export function TabBar(): React.ReactElement {
  const { tabs: list, activeId } = useTabs()
  const labels = tabLabels(list)
  const refs = useRef(new Map<string, HTMLDivElement>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  useAgentActivity(list)

  useEffect(() => {
    refs.current.get(activeId ?? '')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  function focusTab(index: number): void {
    const tab = list[(index + list.length) % list.length]
    if (tab) {
      refs.current.get(tab.id)?.focus()
    }
  }

  function onKeyDown(event: React.KeyboardEvent, index: number, tab: Tab): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab(index + (event.key === 'ArrowRight' ? 1 : -1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusTab(event.key === 'Home' ? 0 : list.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      tabs.activate(tab.id)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      void closeTab(tab.id)
    }
  }

  function onDrop(event: React.DragEvent, index: number): void {
    event.preventDefault()
    const id = event.dataTransfer.getData('application/x-suikopen-tab')
    if (id) {
      tabs.move(id, index)
    }
    setDragging(null)
  }

  return (
    <header className="tab-bar">
      <div className="tab-strip" ref={scrollRef} role="tablist" aria-label="Open documents">
        {list.map((tab, index) => {
          const label = labels.get(tab.id) ?? 'Untitled'
          const active = tab.id === activeId
          const dirty = isDirty(tab)
          const working = busy(tab)
          const status = [dirty ? 'unsaved changes' : null, working ? 'agent working' : null].filter(Boolean).join(', ')
          return (
            <div
              key={tab.id}
              ref={(element) => {
                if (element) refs.current.set(tab.id, element)
                else refs.current.delete(tab.id)
              }}
              role="tab"
              id={`doc-tab-${tab.id}`}
              aria-selected={active}
              aria-controls="doc-panel"
              aria-label={status ? `${label}, ${status}` : label}
              tabIndex={active ? 0 : -1}
              title={tab.path ?? 'Untitled — not saved yet'}
              className={`doc-tab${active ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${dragging === tab.id ? ' dragging' : ''}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-suikopen-tab', tab.id)
                event.dataTransfer.effectAllowed = 'move'
                setDragging(tab.id)
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, index)}
              onPointerDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault()
                  void closeTab(tab.id)
                } else if (event.button === 0) {
                  tabs.activate(tab.id)
                }
              }}
              onDoubleClick={() => tabs.togglePin(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index, tab)}
            >
              <svg className="doc-tab-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 1.5 10.5 6 6 10.5 1.5 6z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              {tab.pinned ? null : <span className="doc-tab-name">{middleEllipsis(label)}</span>}
              {working ? <span className="doc-tab-spinner" aria-hidden="true" /> : null}
              {tab.pinned ? null : (
                <button
                  type="button"
                  className={`doc-tab-close${dirty && !working ? ' dirty' : ''}`}
                  aria-label={`Close ${label}`}
                  tabIndex={-1}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    void closeTab(tab.id)
                  }}
                >
                  <span className="doc-tab-dot" aria-hidden="true" />
                  <svg className="doc-tab-x" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
        <div
          className="tab-drop-end"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onDrop(event, list.length)}
        />
      </div>
      <button type="button" className="tab-action tab-new" aria-label="New tab" title="New tab  ⌘T" onClick={() => void newTab()}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <div className="tab-bar-fill" />
      <AllTabsMenu list={list} labels={labels} activeId={activeId} />
    </header>
  )
}

function AllTabsMenu({ list, labels, activeId }: { list: readonly Tab[]; labels: Map<string, string>; activeId: string | null }): React.ReactElement {
  const { open, setOpen, close, rootRef, triggerRef, id } = usePopover()
  const { active, setActive, onKey } = useListNavigation(list.length, open)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) {
      listRef.current?.focus()
    }
  }, [open])

  function choose(index: number): void {
    const tab = list[index]
    if (tab) {
      tabs.activate(tab.id)
    }
    close()
  }

  return (
    <div className="tab-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="tab-action"
        aria-label="All tabs"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="All tabs"
        onClick={() => setOpen(!open)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3.5 5.5 7 9l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul
          className="tab-menu-list"
          id={id}
          role="listbox"
          aria-label="All tabs"
          tabIndex={-1}
          ref={listRef}
          aria-activedescendant={list[active] ? `${id}-${list[active]!.id}` : undefined}
          onKeyDown={(event) => onKey(event, choose, close)}
        >
          {list.map((tab, index) => (
            <li
              key={tab.id}
              id={`${id}-${tab.id}`}
              role="option"
              aria-selected={tab.id === activeId}
              className={`${index === active ? 'highlight' : ''}${tab.id === activeId ? ' current' : ''}`}
              title={tab.path ?? 'Untitled — not saved yet'}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span>{labels.get(tab.id)}</span>
              {isDirty(tab) ? <span className="tab-menu-dirty">Unsaved</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
