import { useEffect, useRef, useState } from 'react'
import type { AgentSkill } from '../../shared/agent'
import { useListNavigation, usePopover } from './Popover'

export function SkillPicker({
  skills,
  selected,
  popover,
  onToggle,
  onDone,
}: {
  skills: AgentSkill[]
  selected: string[]
  popover: ReturnType<typeof usePopover>
  onToggle: (name: string) => void
  onDone: () => void
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLowerCase()
  const matches = skills.filter(
    (skill) => !needle || skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)
  )
  const list = useListNavigation(matches.length, popover.open)

  useEffect(() => {
    if (popover.open) {
      setQuery('')
      inputRef.current?.focus()
    }
  }, [popover.open])

  useEffect(() => {
    document.getElementById(`${popover.id}-${list.active}`)?.scrollIntoView({ block: 'nearest' })
  }, [list.active, popover.id])

  function choose(index: number): void {
    const skill = matches[index]
    if (skill) {
      onToggle(skill.name)
      finish()
    }
  }

  function finish(): void {
    popover.setOpen(false)
    onDone()
  }

  return (
    <div className="picker" ref={popover.rootRef}>
      <button
        ref={popover.triggerRef}
        className="icon-button"
        aria-label="Add skills"
        title="Add skills  /"
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        aria-controls={popover.id}
        onClick={() => popover.setOpen(!popover.open)}
      >
        /
      </button>
      {popover.open ? (
        <div className="popover popover-up popover-wide">
          <input
            ref={inputRef}
            className="popover-search"
            placeholder="Search skills"
            aria-label="Search skills"
            role="combobox"
            aria-expanded="true"
            aria-controls={popover.id}
            aria-activedescendant={matches.length ? `${popover.id}-${list.active}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => list.onKey(event, choose, finish)}
          />
          <div id={popover.id} role="listbox" aria-multiselectable="true" aria-label="Skills" className="popover-scroll">
            {matches.length === 0 ? (
              <div className="popover-empty">
                No skills match.
              </div>
            ) : null}
            {matches.map((skill, index) => {
              const on = selected.includes(skill.name)
              return (
                <div
                  key={skill.name}
                  id={`${popover.id}-${index}`}
                  role="option"
                  aria-selected={on}
                  className={`popover-row popover-option popover-stack${index === list.active ? ' active' : ''}`}
                  onPointerMove={() => list.setActive(index)}
                  onClick={() => choose(index)}
                >
                  <span className="popover-check">{on ? '✓' : ''}</span>
                  <span className="popover-text">
                    <span className="popover-name">
                      {skill.name}
                      {skill.builtIn ? <span className="popover-badge">Built-in</span> : null}
                    </span>
                    {skill.description ? <span className="popover-desc">{skill.description}</span> : null}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
