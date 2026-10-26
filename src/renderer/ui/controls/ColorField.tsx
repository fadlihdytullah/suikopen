import { useEffect, useState } from 'react'

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function ColorField({
  label,
  value,
  resolved,
  mixed,
  onCommit,
  onDetach,
}: {
  label: string
  value: string | null
  resolved: string | null
  mixed?: boolean
  onCommit: (value: string) => void
  onDetach?: () => void
}): React.ReactElement {
  const [draft, setDraft] = useState('')
  const token = value?.startsWith('$') ? value : null
  const swatch = resolved && HEX.test(resolved) ? resolved : '#000000'

  useEffect(() => {
    setDraft(mixed ? '' : (value ?? '').replace(/^#/, '').toUpperCase())
  }, [value, mixed])

  return (
    <div className="color-field">
      <span className="color-swatch" style={{ background: mixed ? undefined : swatch }}>
        <input type="color" aria-label={`${label} colour`} value={swatch.slice(0, 7).toLowerCase()} onChange={(event) => onCommit(event.target.value)} />
      </span>
      {token ? (
        <span className="token-chip" title={`Variable ${token}`}>
          {token.slice(1)}
          {onDetach ? (
            <button aria-label={`Detach variable ${token.slice(1)}`} title="Detach variable" onClick={onDetach}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </span>
      ) : (
        <input
          className="field-input color-hex"
          aria-label={`${label} hex`}
          value={draft}
          placeholder={mixed ? 'Mixed' : ''}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const next = `#${draft.replace(/^#/, '')}`
            if (HEX.test(next) && next.toUpperCase() !== (value ?? '').toUpperCase()) {
              onCommit(next.toUpperCase())
            } else {
              setDraft((value ?? '').replace(/^#/, '').toUpperCase())
            }
          }}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
      )}
    </div>
  )
}
