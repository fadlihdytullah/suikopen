import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  ATTACHMENT_HINT,
  FALLBACK_MODELS,
  PROVIDERS,
  shouldCompact,
  layersBlock,
  type ChatEntry,
  type AgentEffort,
  type AgentModelOption,
  type AgentProviderId,
  type AgentProviderStatus,
  type AgentSkill,
} from '../../shared/agent'
import { requestFit } from '../canvas/viewport-ref'
import { ModelPicker } from './ModelPicker'
import { usePopover } from './Popover'
import { SkillPicker } from './SkillPicker'
import { attachmentError, AttachmentChips, DropOverlay, isLongPaste, SentAttachments, sendableAttachments, useAttachments, useFileDrop } from './Attachments'
import { openSettings, refreshStatuses, setProvider, useSettings } from './settings-state'
import { ChatPicker } from './ChatPicker'
import { showLeftTab } from './panel-state'
import { LayerChip, layersKey, useSelectedLayers } from './LayerRefs'
import { touchedIds } from '../../shared/handoff'
import { handoffFor } from '../agent/handoff'
import { MEMORY_KINDS, upsertNote, type MemoryKind } from '../../shared/schema/memory'
import { tabLabels, tabs, useActiveTab } from '../tabs/tabs-store'

type Entry = ChatEntry

function chatTitle(entries: Entry[]): string {
  const first = entries.find((entry) => entry.kind === 'user')
  return (first?.kind === 'user' ? first.text || first.files[0]?.name : undefined)?.slice(0, 80) || 'New chat'
}

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

function sinceCompaction(entries: readonly ChatEntry[]): ChatEntry[] {
  let last = entries.length - 1
  while (last >= 0 && entries[last]!.kind !== 'compacted') last -= 1
  return entries.slice(last + 1)
}

function transcriptOf(entries: readonly ChatEntry[], handoff: string | null): string {
  const lines = sinceCompaction(entries).flatMap((entry) => {
    if (entry.kind === 'user') return [`User: ${entry.text}`]
    if (entry.kind === 'assistant') return [`Agent: ${entry.text}`]
    if (entry.kind === 'tools') return [`(tools: ${entry.names.join(', ')})`]
    if (entry.kind === 'memory') return [`(remembered: ${entry.text})`]
    return []
  })
  return [handoff ? `Earlier summary: ${handoff}` : '', ...lines].filter(Boolean).join('\n\n')
}

function CopyReply({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  return (
    <div className="agent-reply-actions">
      <button
        type="button"
        className="icon-button"
        aria-label={copied ? 'Copied' : 'Copy response'}
        title={copied ? 'Copied' : 'Copy response'}
        onClick={() => {
          void navigator.clipboard.writeText(text.trim()).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {copied ? <path d="M3 7.5 6 10.5l5-6" /> : <path d="M5 4.5V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H9.5M3 5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />}
        </svg>
      </button>
      <span className="sr-only" aria-live="polite">{copied ? 'Response copied' : ''}</span>
    </div>
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
  const handoffRef = useRef<string | null>(null)
  const contextRef = useRef<number | null>(null)
  const chatTab = useRef<string | null>(null)
  const autoCompact = useRef(false)
  const [compacting, setCompacting] = useState(false)
  const [copied, setCopied] = useState(false)
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
  const activeTab = useActiveTab()
  const selectedLayers = useSelectedLayers(activeTab ?? null)
  const [droppedLayers, setDroppedLayers] = useState<string | null>(null)
  const layers = layersKey(selectedLayers) === droppedLayers ? [] : selectedLayers
  const documentPath = activeTab?.path ?? null
  const runTab = useRef<string | null>(null)
  const chatRef = useRef<{ id: string; createdAt: number } | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const busyRef = useRef(busy)

  function persist(): void {
    if (entries.length === 0) return
    chatRef.current ??= { id: crypto.randomUUID(), createdAt: Date.now() }
    setChatId(chatRef.current.id)
    const owner = tabs.get(chatTab.current) ?? tabs.active()
    if (!owner) return
    chatTab.current = owner.id
    owner.chatId = chatRef.current.id
    void window.suikopen.saveChat({
      ...chatRef.current,
      title: chatTitle(entries),
      documentPath: owner.path,
      tabId: owner.id,
      provider,
      model,
      sessionId: sessionRef.current,
      updatedAt: Date.now(),
      entries,
      ...(handoffRef.current ? { handoff: handoffRef.current } : {}),
      ...(contextRef.current ? { contextTokens: contextRef.current } : {}),
    })
  }

  useEffect(() => {
    if (busyRef.current === busy) return
    busyRef.current = busy
    persist()
  }, [busy])

  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(persist, 1500)
    return () => clearTimeout(timer)
  }, [entries, busy])

  useEffect(() => {
    if (chatTab.current && chatTab.current === activeTab?.id && chatRef.current) persist()
  }, [documentPath])

  useEffect(() => {
    if (busy || !autoCompact.current) return
    autoCompact.current = false
    if (shouldCompact(provider, contextRef.current, sinceCompaction(entries))) void compact()
  }, [busy])

  async function copyHandoff(): Promise<void> {
    const tab = tabs.get(chatTab.current) ?? tabs.active()
    if (!tab) return
    await navigator.clipboard.writeText(handoffFor(tab, { entries, handoff: handoffRef.current }))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function compact(): Promise<void> {
    if (busy || sinceCompaction(entries).length === 0) return
    const tabId = chatTab.current && tabs.get(chatTab.current) ? chatTab.current : tabs.getState().activeId
    setCompacting(true)
    setBusy(true)
    const result = await window.suikopen.compactChat({
      provider,
      model,
      sessionId: sessionRef.current,
      transcript: transcriptOf(entries, handoffRef.current),
      ...(tabId ? { tab: { id: tabId, name: tabLabels(tabs.getState().tabs).get(tabId) ?? tabId } } : {}),
    })
    if (result.ok) {
      const store = tabId ? tabs.get(tabId)?.store : undefined
      if (store && result.notes.length) {
        store.setMemory((current) =>
          result.notes.reduce(
            (notes, note) => upsertNote(notes, { key: note.key, kind: MEMORY_KINDS.includes(note.kind as MemoryKind) ? (note.kind as MemoryKind) : 'note', text: note.text, by: 'agent' }, crypto.randomUUID().slice(0, 8), Date.now()).notes,
            current
          )
        )
      }
      handoffRef.current = result.handoff
      sessionRef.current = null
      contextRef.current = null
      setEntries((current) => [...current, { kind: 'compacted', handoff: result.handoff }])
    } else {
      setEntries((current) => [...current, { kind: 'error', text: `Could not summarise this chat: ${result.error}` }])
    }
    setCompacting(false)
    setBusy(false)
  }

  const activeId = activeTab?.id ?? null

  useEffect(() => {
    if (busy || !activeId) return
    if (chatTab.current === activeId && (entries.length || chatRef.current)) return
    const tab = tabs.get(activeId)
    if (!tab) return
    let current = true
    reset(false)
    chatTab.current = activeId
    const load = tab.chatId ? Promise.resolve(tab.chatId) : window.suikopen.listChats(tab.path, tab.id).then((chats) => chats[0]?.id)
    void load.then((id) => {
      if (current && id && tabs.getState().activeId === activeId) void openChat(id)
    })
    return () => {
      current = false
    }
  }, [activeId, busy])

  async function openChat(id: string): Promise<void> {
    if (busy || id === chatRef.current?.id) return
    const record = await window.suikopen.getChat(id)
    if (!record) return
    if (record.provider !== providerRef.current) {
      providerRef.current = record.provider
      setProvider(record.provider)
    }
    setModel(record.model)
    sessionRef.current = record.sessionId
    handoffRef.current = record.handoff ?? null
    contextRef.current = record.contextTokens ?? null
    chatRef.current = { id: record.id, createdAt: record.createdAt }
    setChatId(record.id)
    setEntries(record.entries)
    setCost(null)
    setAttached([])
    files.clear()
  }

  async function deleteCurrent(): Promise<void> {
    const id = chatRef.current?.id
    if (!id || busy) return
    await window.suikopen.deleteChat(id)
    reset()
  }

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

      if (event.kind === 'tool' && event.name === 'remember') {
        const note = (event.input as { text?: unknown } | null)?.text
        if (typeof note === 'string') {
          setEntries((current) => [...current, { kind: 'memory', text: note }])
          return
        }
      }

      if (event.kind === 'tool') {
        const ids = touchedIds(event.name, event.input)
        setEntries((current) => {
          const last = current[current.length - 1]
          if (last?.kind === 'tools') {
            const merged = [...new Set([...(last.ids ?? []), ...ids])]
            return [...current.slice(0, -1), { kind: 'tools', names: [...last.names, event.name], ...(merged.length ? { ids: merged } : {}) }]
          }
          return [...current, { kind: 'tools', names: [event.name], ...(ids.length ? { ids } : {}) }]
        })
        return
      }

      sessionRef.current = event.sessionId
      if (event.contextTokens) contextRef.current = event.contextTokens
      autoCompact.current = !event.error
      setCost(event.costUsd)
      setBusy(false)
      tabs.get(runTab.current)?.presence.setWorking(false)
      runTab.current = null
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
    if (skills.find((skill) => skill.name === name)?.builtIn && !attached.includes(name) && !busy && ready) {
      send(draft.trim() || 'Hand off the latest design update.', true, [...attached, name])
      return
    }
    setAttached((current) => (current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]))
  }

  function send(text = draft, withFiles = true, withSkills = attached): void {
    const chosen = withFiles ? sendableAttachments(files.items) : []
    const attachments = chosen.map(({ path, name, kind, mime, size }) => ({ path, name, kind, mime, size }))
    const typed = text.trim()
    if ((!typed && attachments.length === 0) || busy || !ready || (withFiles && fileProblem)) {
      return
    }
    const prompt = `${typed || 'Use the attached files.'}${layersBlock(layers)}`
    const sentLayers = layers.map(({ id, name, type }) => ({ id, name, type }))
    const sent = chosen.map(({ name, kind, thumbnail, pasted }) => ({ name, kind, ...(thumbnail ? { thumbnail } : {}), ...(pasted ? { lines: pasted.lines } : {}) }))
    setEntries((current) => [...current, { kind: 'user', text: typed, skills: withSkills, files: sent, ...(sentLayers.length ? { layers: sentLayers } : {}) }])
    setDraft('')
    if (withFiles) files.clear()
    setBusy(true)
    runTab.current = tabs.getState().activeId
    chatTab.current = runTab.current
    tabs.active()?.presence.setWorking(true)
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    const efforts = models.find((option) => option.value === model)?.efforts ?? []
    void window.suikopen.runAgent({
      provider,
      prompt,
      attachments,
      sessionId: sessionRef.current,
      model,
      effort: effort && efforts.includes(effort) ? effort : null,
      skills: withSkills,
      memory: tabs.active()?.store.getState().memory ?? [],
      ...(handoffRef.current ? { handoff: handoffRef.current } : {}),
      ...(runTab.current ? { tab: { id: runTab.current, name: tabLabels(tabs.getState().tabs).get(runTab.current) ?? runTab.current } } : {}),
    })
  }

  function reset(focus = true): void {
    sessionRef.current = null
    handoffRef.current = null
    contextRef.current = null
    chatRef.current = null
    setChatId(null)
    setEntries([])
    setCost(null)
    setAttached([])
    files.clear()
    if (focus) inputRef.current?.focus()
  }

  return (
    <div className="agent" {...drop.handlers}>
      <DropOverlay visible={drop.over} />
      <p className="sr-only" aria-live="polite">
        {drop.over ? 'Drop to attach files.' : files.announcement}
      </p>
      <header className="agent-head">
        <ChatPicker
          title={chatTitle(entries)}
          currentId={chatId}
          documentPath={documentPath}
          tabId={activeTab?.id}
          disabled={busy}
          onOpen={(id) => void openChat(id)}
          onDelete={() => void deleteCurrent()}
        />
        <button
          className="icon-button"
          aria-label={copied ? 'Handoff copied' : 'Copy handoff for a coding agent'}
          title={copied ? 'Copied' : 'Copy handoff\nWhat was asked, decided and changed, to paste into a coding agent'}
          onClick={() => void copyHandoff()}
          disabled={entries.length === 0}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {copied ? <path d="M3 7.5 6 10.5l5-6" /> : <path d="M5 4.5V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H9.5M3 5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />}
          </svg>
        </button>
        <span className="sr-only" aria-live="polite">{copied ? 'Handoff copied' : ''}</span>
        <button className="icon-button" aria-label="New chat" title="New chat" onClick={() => reset()} disabled={busy || entries.length === 0}>
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
          if (entry.kind === 'memory') {
            return (
              <div key={index} className="agent-memory">
                <span>Remembered: {entry.text}</span>
                <button type="button" onClick={() => showLeftTab('memory')}>View</button>
              </div>
            )
          }
          if (entry.kind === 'compacted') {
            return (
              <div key={index} className="agent-compacted" role="note">
                Earlier messages summarised
              </div>
            )
          }
          if (entry.kind === 'assistant') {
            return (
              <div key={index} className="agent-assistant md">
                <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                  {entry.text}
                </Markdown>
                {busy && index === entries.length - 1 ? null : <CopyReply text={entry.text} />}
              </div>
            )
          }
          if (entry.kind === 'user') {
            return (
              <div key={index} className="agent-user">
                {entry.skills.length ? <div className="agent-user-skills">{entry.skills.map((name) => `/${name}`).join(' ')}</div> : null}
                {entry.layers?.length ? (
                  <div className="sent-layers">
                    <LayerChip layers={entry.layers} />
                  </div>
                ) : null}
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
              {compacting ? 'Summarising earlier messages…' : 'Designing…'}
            </>
          ) : null}
        </div>
      </div>

      <div className="agent-compose">
        {layers.length ? (
          <div className="agent-layer-refs">
            <LayerChip layers={layers} onRemove={() => setDroppedLayers(layersKey(selectedLayers))} />
          </div>
        ) : null}
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
