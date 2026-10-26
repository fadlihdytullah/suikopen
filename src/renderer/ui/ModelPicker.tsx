import { useEffect, useRef } from 'react'
import { EFFORT_LABELS, PROVIDERS, type AgentEffort, type AgentModelOption, type AgentProviderId, type AgentProviderStatus } from '../../shared/agent'
import { useListNavigation, usePopover } from './Popover'

function statusNote(status: AgentProviderStatus | undefined): string | undefined {
  if (!status) {
    return undefined
  }
  if (!status.executable) {
    return 'Not installed'
  }
  return status.signedIn === false ? 'Sign in needed' : undefined
}

export function ModelPicker({
  provider,
  statuses,
  onProviderChange,
  models,
  value,
  onChange,
  effort,
  onEffortChange,
}: {
  provider: AgentProviderId
  statuses: Partial<Record<AgentProviderId, AgentProviderStatus>>
  onProviderChange: (provider: AgentProviderId) => void
  models: AgentModelOption[]
  value: string
  onChange: (value: string) => void
  effort: AgentEffort | null
  onEffortChange: (effort: AgentEffort | null) => void
}): React.ReactElement {
  const popover = usePopover()
  const list = useListNavigation(models.length, popover.open)
  const listRef = useRef<HTMLDivElement>(null)
  const current = models.find((model) => model.value === value) ?? models[0]
  const providerName = PROVIDERS.find((entry) => entry.id === provider)?.name
  const efforts = current?.efforts ?? []
  const appliedEffort = effort && efforts.includes(effort) ? effort : null

  useEffect(() => {
    if (popover.open) {
      const index = models.findIndex((model) => model.value === value)
      list.setActive(Math.max(0, index))
      listRef.current?.focus()
    }
  }, [popover.open])

  useEffect(() => {
    document.getElementById(`${popover.id}-${list.active}`)?.scrollIntoView({ block: 'nearest' })
  }, [list.active, popover.id])

  function choose(index: number): void {
    const model = models[index]
    if (model) {
      onChange(model.value)
      popover.close()
    }
  }

  return (
    <div className="picker" ref={popover.rootRef}>
      <button
        ref={popover.triggerRef}
        className="chip-button"
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        aria-controls={popover.id}
        onClick={() => popover.setOpen(!popover.open)}
      >
        <span className="chip-muted">{providerName}</span>
        <span>
          {current?.name.replace(/\s*\(recommended\)$/i, '') ?? 'Auto'}
          {appliedEffort ? <span className="chip-muted"> · {EFFORT_LABELS[appliedEffort]}</span> : null}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {popover.open ? (
        <div className="popover popover-up popover-wide">
          <div className="popover-label" id={`${popover.id}-provider`}>
            Provider
          </div>
          <div role="radiogroup" aria-labelledby={`${popover.id}-provider`}>
            {PROVIDERS.map((entry) => {
              const note = statusNote(statuses[entry.id])
              return (
                <button
                  key={entry.id}
                  role="radio"
                  aria-checked={entry.id === provider}
                  className="popover-row popover-option popover-radio"
                  onClick={() => onProviderChange(entry.id)}
                  onKeyDown={(event) => event.key === 'Escape' && popover.close()}
                >
                  <span className="popover-check">{entry.id === provider ? '●' : '○'}</span>
                  <span className="popover-name">{entry.name}</span>
                  {note ? <span className="popover-hint">{note}</span> : null}
                </button>
              )
            })}
          </div>
          <div className="popover-divider" />
          <div className="popover-label" id={`${popover.id}-label`}>
            Model
          </div>
          <div
            ref={listRef}
            id={popover.id}
            role="listbox"
            tabIndex={0}
            aria-labelledby={`${popover.id}-label`}
            aria-activedescendant={`${popover.id}-${list.active}`}
            className="popover-scroll"
            onKeyDown={(event) => list.onKey(event, choose, popover.close)}
          >
            {models.map((model, index) => (
              <div
                key={model.value}
                id={`${popover.id}-${index}`}
                role="option"
                aria-selected={model.value === value}
                className={`popover-row popover-option popover-stack${index === list.active ? ' active' : ''}`}
                onPointerMove={() => list.setActive(index)}
                onClick={() => choose(index)}
              >
                <span className="popover-check">{model.value === value ? '✓' : ''}</span>
                <span className="popover-text">
                  <span className="popover-name">{model.name}</span>
                  {model.description ? <span className="popover-desc">{model.description}</span> : null}
                </span>
              </div>
            ))}
          </div>
          {efforts.length ? (
            <>
              <div className="popover-divider" />
              <div className="popover-label" id={`${popover.id}-effort`}>
                Effort
              </div>
              <div className="segmented" role="radiogroup" aria-labelledby={`${popover.id}-effort`}>
                {[null, ...efforts].map((level) => (
                  <button
                    key={level ?? 'auto'}
                    role="radio"
                    aria-checked={appliedEffort === level}
                    className={appliedEffort === level ? 'active' : ''}
                    onClick={() => onEffortChange(level)}
                    onKeyDown={(event) => event.key === 'Escape' && popover.close()}
                  >
                    {level ? EFFORT_LABELS[level] : 'Auto'}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
