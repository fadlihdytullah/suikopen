import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  ATTACHMENT_HINT,
  FALLBACK_MODELS,
  PROVIDERS,
  type AgentAttachmentKind,
  type AgentEffort,
  type AgentModelOption,
  type AgentProviderId,
  type AgentProviderStatus,
  type AgentSkill,
} from '../../shared/agent'
import { requestFit } from '../canvas/viewport-ref'
import { setAgentWorking } from '../agent/presence'
import { ModelPicker } from './ModelPicker'
import { usePopover } from './Popover'
import { SkillPicker } from './SkillPicker'
import { attachmentError, AttachmentChips, DropOverlay, isLongPaste, SentAttachments, sendableAttachments, useAttachments, useFileDrop } from './Attachments'
import { openSettings, refreshStatuses, setProvider, useSettings } from './settings-state'

type Entry =
  | { kind: 'user'; text: string; skills: string[]; files: { name: string; kind: AgentAttachmentKind; thumbnail?: string; lines?: number }[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'tools'; names: string[] }
  | { kind: 'error'; text: string; signIn?: AgentProviderId }

const MODEL_KEY = 'suikopen.agent.model'
const EFFORT_KEY = 'suikopen.agent.effort'
const STARTERS = ['Design a sign-in screen for a mobile app', 'Tidy the spacing on the selected frame', 'Add an empty state to this screen']

function modelKey(provider: AgentProviderId): string {
  return provider === DEFAULT_PROVIDER ? MODEL_KEY : `${MODEL_KEY}.${provider}`
}

function ProviderNotice({
  provider,
  status,
}: {
  provider: AgentProviderId
  status: AgentProviderStatus | undefined
}): React.ReactElement | null {
  const definition = PROVIDERS.find((entry) => entry.id === provider)
  if (!definition || !status) {
    return null
  }
  if (!status.executable) {
    return (
      <div className="agent-notice" role="alert">
        <p>{definition.name} isn't installed.</p>
        <button onClick={() => openSettings('agents')}>Set up</button>
      </div>
    )
  }
  if (status.signedIn === false) {
    return (
      <div className="agent-notice" role="alert">
        <p>Sign in to {definition.name} to use your plan.</p>
        <button onClick={() => void window.suikopen.agentSignIn(provider)}>Sign in</button>
      </div>
    )
  }
  return null
}

function CodeBlock({ children }: { children?: React.ReactNode }): React.ReactElement {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  return (
    <div className="md-code">
      <pre ref={ref}>{children}</pre>
      <button
        className="md-copy"
        aria-label={copied ? 'Copied' : 'Copy code'}
        onClick={() => {
          void navigator.clipboard.writeText(ref.current?.innerText ?? '')
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

const MARKDOWN_COMPONENTS = {
  pre: CodeBlock,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

function ToolGroup({ names }: { names: string[] }): React.ReactElement {
  return (
    <details className="agent-tools">
      <summary>
        Used {names.length} {names.length === 1 ? 'tool' : 'tools'}
      </summary>
      <ul>
        {names.map((name, index) => (
          <li key={index}>{name.replaceAll('_', ' ')}</li>
        ))}
      </ul>
    </details>
  )
}

export function AgentPanel(): React.ReactElement {
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const { provider, statuses } = useSettings()
  const [model, setModel] = useState(() => localStorage.getItem(modelKey(provider)) ?? DEFAULT_MODEL)
  const [effort, setEffort] = useState(() => localStorage.getItem(EFFORT_KEY) as AgentEffort | null)
  const [models, setModels] = useState<AgentModelOption[]>(FALLBACK_MODELS[provider])
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [attached, setAttached] = useState<string[]>([])
  const [cost, setCost] = useState<number | null>(null)
  const ready = statuses[provider]?.executable !== null
  const sessionRef = useRef<string | null>(null)
  const providerRef = useRef(provider)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const skillPopover = usePopover()
  const files = useAttachments()
  const drop = useFileDrop((dropped) => {
    void files.addFiles(dropped)
    inputRef.current?.focus()
  })
  const fileProblem = files.items.some((item) => attachmentError(item, provider))
  const lastPaste = useRef<{ id: string; draft: string } | null>(null)

  function insertText(text: string): void {
    const input = inputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + text + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  function unpaste(id: string): void {
    const item = files.items.find((entry) => entry.id === id)
    if (!item?.pasted) return
    files.remove(id)
    lastPaste.current = null
    insertText(item.pasted.text)
  }

  useEffect(() => {
    void window.suikopen.agentSkills().then(setSkills)

    return window.suikopen.onAgentEvent((event) => {
      if (event.kind === 'text') {
        setEntries((current) => {
          const last = current[current.length - 1]
          if (last?.kind === 'assistant') {
            return [...current.slice(0, -1), { kind: 'assistant', text: last.text + event.text }]
          }
          return [...current, { kind: 'assistant', text: event.text }]
        })
        return
      }

      if (event.kind === 'tool') {
        setEntries((current) => {
          const last = current[current.length - 1]
          if (last?.kind === 'tools') {
            return [...current.slice(0, -1), { kind: 'tools', names: [...last.names, event.name] }]
          }
          return [...current, { kind: 'tools', names: [event.name] }]
        })
        return
      }

      sessionRef.current = event.sessionId
      setCost(event.costUsd)
      setBusy(false)
      setAgentWorking(false)
      requestFit()
      const error = event.error
      if (error) {
        const signIn = event.signIn ? providerRef.current : undefined
        setEntries((current) => [...current, { kind: 'error', text: error, ...(signIn ? { signIn } : {}) }])
      }
    })
  }, [])

  useEffect(() => {
    refreshStatuses()
    window.addEventListener('focus', refreshStatuses)
    return () => window.removeEventListener('focus', refreshStatuses)
  }, [])

  useEffect(() => {
    if (providerRef.current !== provider) {
      providerRef.current = provider
      setModel(localStorage.getItem(modelKey(provider)) ?? DEFAULT_MODEL)
      reset()
    }
    let current = true
    setModels(FALLBACK_MODELS[provider])
    void window.suikopen.agentModels(provider).then((found) => current && setModels(found))
    return () => {
      current = false
    }
  }, [provider])

  useEffect(() => {
    const list = listRef.current
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 120) {
      list.scrollTo({ top: list.scrollHeight })
    }
  }, [entries, busy])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (input?.offsetParent) {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 200)}px`
    }
  }, [draft])

  function chooseModel(value: string): void {
    setModel(value)
    localStorage.setItem(modelKey(provider), value)
  }

  function chooseProvider(value: AgentProviderId): void {
    if (value !== provider && !busy) {
      setProvider(value)
    }
  }

  function chooseEffort(value: AgentEffort | null): void {
    setEffort(value)
    if (value) {
      localStorage.setItem(EFFORT_KEY, value)
    } else {
      localStorage.removeItem(EFFORT_KEY)
    }
  }

  function toggleSkill(name: string): void {
    setAttached((current) => (current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]))
  }

  function send(text = draft, withFiles = true): void {
    const chosen = withFiles ? sendableAttachments(files.items) : []
    const attachments = chosen.map(({ path, name, kind, mime, size }) => ({ path, name, kind, mime, size }))
    const typed = text.trim()
    if ((!typed && attachments.length === 0) || busy || !ready || (withFiles && fileProblem)) {
      return
    }
    const prompt = typed || 'Use the attached files.'
    const sent = chosen.map(({ name, kind, thumbnail, pasted }) => ({ name, kind, ...(thumbnail ? { thumbnail } : {}), ...(pasted ? { lines: pasted.lines } : {}) }))
    setEntries((current) => [...current, { kind: 'user', text: typed, skills: attached, files: sent }])
    setDraft('')
    if (withFiles) files.clear()
    setBusy(true)
    setAgentWorking(true)
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    const efforts = models.find((option) => option.value === model)?.efforts ?? []
    void window.suikopen.runAgent({
      provider,
      prompt,
      attachments,
      sessionId: sessionRef.current,
      model,
      effort: effort && efforts.includes(effort) ? effort : null,
      skills: attached,
    })
  }

  function reset(): void {
    sessionRef.current = null
    setEntries([])
    setCost(null)
    setAttached([])
    files.clear()
    inputRef.current?.focus()
  }

  const firstPrompt = entries.find((entry) => entry.kind === 'user')

  return (
    <div className="agent" {...drop.handlers}>
      <DropOverlay visible={drop.over} />
      <p className="sr-only" aria-live="polite">
        {drop.over ? 'Drop to attach files.' : files.announcement}
      </p>
      <header className="agent-head">
        <h2 className="agent-title">{firstPrompt?.kind === 'user' ? firstPrompt.text || firstPrompt.files[0]?.name : 'New chat'}</h2>
        <button className="icon-button" aria-label="Agent settings" title="Agent settings  ⌘," onClick={() => openSettings('agents')}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 4h6M11 4h1M2 10h1M6 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="9.5" cy="4" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="4.5" cy="10" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button className="icon-button" aria-label="New chat" title="New chat" onClick={reset} disabled={busy || entries.length === 0}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <ProviderNotice provider={provider} status={statuses[provider]} />

      <div className="agent-log" ref={listRef}>
        {entries.length === 0 ? (
          <div className="agent-empty">
            <p>Describe a screen or a change. The agent edits this document, and you can undo every edit.</p>
            <div className="agent-starters">
              {STARTERS.map((starter) => (
                <button key={starter} className="agent-starter" onClick={() => send(starter, false)} disabled={busy || !ready}>
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {entries.map((entry, index) => {
          if (entry.kind === 'tools') {
            return <ToolGroup key={index} names={entry.names} />
          }
          if (entry.kind === 'assistant') {
            return (
              <div key={index} className="agent-assistant md">
                <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                  {entry.text}
                </Markdown>
              </div>
            )
          }
          if (entry.kind === 'user') {
            return (
              <div key={index} className="agent-user">
                {entry.skills.length ? <div className="agent-user-skills">{entry.skills.map((name) => `/${name}`).join(' ')}</div> : null}
                <SentAttachments items={entry.files} />
                {entry.text}
              </div>
            )
          }
          const signIn = entry.signIn
          return (
            <div key={index} className="agent-error" role="alert">
              {entry.text}
              {signIn ? (
                <button className="agent-error-action" onClick={() => void window.suikopen.agentSignIn(signIn)}>
                  Sign in again
                </button>
              ) : null}
            </div>
          )
        })}
        <div className="agent-working" aria-live="polite">
          {busy ? (
            <>
              <span />
              <span />
              <span />
              Designing…
            </>
          ) : null}
        </div>
      </div>

      <div className="agent-compose">
        <AttachmentChips items={files.items} provider={provider} onRemove={files.remove} onInsert={unpaste} />
        {attached.length ? (
          <ul className="agent-chips" aria-label="Attached skills">
            {attached.map((name) => (
              <li key={name} className="agent-chip">
                {name}
                <button aria-label={`Remove ${name}`} onClick={() => toggleSkill(name)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={inputRef}
          className="agent-input"
          rows={2}
          value={draft}
          aria-label="Message the agent"
          placeholder="Describe a screen or change. Type / for skills, drop files to attach"
          onChange={(event) => {
            const next = event.target.value
            if (next.length === draft.length + 1 && next.endsWith('/') && /(^|\s)$/.test(draft)) {
              skillPopover.setOpen(true)
              return
            }
            setDraft(event.target.value)
          }}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files]
            if (pasted.length) {
              event.preventDefault()
              void files.addFiles(pasted)
              return
            }
            const text = event.clipboardData.getData('text/plain')
            if (isLongPaste(text)) {
              event.preventDefault()
              const before = draft
              void files.addText(text).then((id) => {
                lastPaste.current = id ? { id, draft: before } : null
              })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'z' && (event.metaKey || event.ctrlKey) && !event.shiftKey && lastPaste.current?.draft === draft) {
              event.preventDefault()
              unpaste(lastPaste.current.id)
              return
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="agent-compose-bar">
          <button className="icon-button" aria-label="Attach files" title={`Attach files\n${ATTACHMENT_HINT}`} onClick={() => void files.pick()}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11.5 6.75 7.1 11.15a2.9 2.9 0 0 1-4.1-4.1l4.6-4.6a1.95 1.95 0 0 1 2.75 2.75L5.75 9.8a1 1 0 0 1-1.4-1.4l4.1-4.1" />
            </svg>
          </button>
          <SkillPicker skills={skills} selected={attached} popover={skillPopover} onToggle={toggleSkill} onDone={() => inputRef.current?.focus()} />
          <ModelPicker
            provider={provider}
            statuses={statuses}
            onProviderChange={chooseProvider}
            models={models} value={model} onChange={chooseModel} effort={effort} onEffortChange={chooseEffort} />
          <span className="agent-spacer" />
          {busy ? (
            <button className="send-button" aria-label="Stop" title="Stop" onClick={() => void window.suikopen.stopAgent()}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button className="send-button" aria-label="Send" title="Send  ↵" onClick={() => send()} disabled={(!draft.trim() && sendableAttachments(files.items).length === 0) || !ready || fileProblem}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {cost !== null ? <p className="agent-cost">${cost.toFixed(2)} this chat</p> : null}
    </div>
  )
}
