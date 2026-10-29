import { useEffect, useState } from 'react'
import { editNote, MEMORY_KINDS, MEMORY_LIMITS, removeNotes, upsertNote, type MemoryKind, type MemoryNote } from '../../shared/schema/memory'
import { useDocument, useDocumentStore } from '../store/use-store'

const KIND_LABELS: Record<MemoryKind, string> = { brand: 'Brand', decision: 'Decision', convention: 'Convention', note: 'Note' }

export const FRESH_MS = 4000

function when(at: number): string {
  if (!at) return ''
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(at).toLocaleDateString()
}

function useFreshTick(notes: readonly MemoryNote[]): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const newest = Math.max(0, ...notes.map((note) => note.at))
    const left = newest + FRESH_MS - Date.now()
    if (left <= 0) return
    const timer = setTimeout(() => setTick((value) => value + 1), left)
    return () => clearTimeout(timer)
  }, [notes])
}

export function MemoryPanel(): React.ReactElement {
  const store = useDocumentStore()
  const notes = useDocument().memory ?? []
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<MemoryKind>('note')
  useFreshTick(notes)

  function add(): void {
    const text = draft.trim()
    if (!text) return
    store.setMemory((current) => upsertNote(current, { kind, text, by: 'user' }, crypto.randomUUID().slice(0, 8), Date.now()).notes)
    setDraft('')
  }

  return (
    <section className="memory" aria-labelledby="memory-title">
      <header className="memory-head">
        <h2 id="memory-title">Memory</h2>
        <span className="memory-count" aria-label={`${notes.length} of ${MEMORY_LIMITS.notes} notes`}>
          {notes.length}/{MEMORY_LIMITS.notes}
        </span>
      </header>
      <p className="memory-hint">Saved in this file. Every agent reads these notes before it starts.</p>

      {notes.length === 0 ? (
        <div className="memory-empty">
          <p>No notes yet</p>
          <p>When you settle a brand colour, a layout or a naming rule, the agent saves it here. You can add your own too.</p>
        </div>
      ) : (
        <ul className="memory-list" aria-label="Notes">
          {[...notes].reverse().map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              editing={editing === note.id}
              onEdit={() => setEditing(note.id)}
              onDone={(patch) => {
                if (patch) store.setMemory((current) => editNote(current, note.id, patch, Date.now()))
                setEditing(null)
              }}
              onDelete={() => store.setMemory((current) => removeNotes(current, [note.id]))}
            />
          ))}
        </ul>
      )}

      <form
        className="memory-add"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <label className="sr-only" htmlFor="memory-new">New note</label>
        <textarea
          id="memory-new"
          rows={2}
          maxLength={MEMORY_LIMITS.text}
          value={draft}
          placeholder="Add a note, e.g. Buttons use 8px radius"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              add()
            }
          }}
        />
        <div className="memory-add-bar">
          <KindSelect value={kind} onChange={setKind} label="Kind of new note" />
          <span className="memory-left" aria-hidden="true">{MEMORY_LIMITS.text - draft.length}</span>
          <button type="submit" className="memory-button primary" disabled={!draft.trim()}>Add note</button>
        </div>
      </form>
    </section>
  )
}

function KindSelect({ value, onChange, label }: { value: MemoryKind; onChange: (kind: MemoryKind) => void; label: string }): React.ReactElement {
  return (
    <select className="memory-kind-select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value as MemoryKind)}>
      {MEMORY_KINDS.map((option) => (
        <option key={option} value={option}>{KIND_LABELS[option]}</option>
      ))}
    </select>
  )
}

function NoteRow({
  note,
  editing,
  onEdit,
  onDone,
  onDelete,
}: {
  note: MemoryNote
  editing: boolean
  onEdit: () => void
  onDone: (patch: { text: string; kind: MemoryKind } | null) => void
  onDelete: () => void
}): React.ReactElement {
  const [text, setText] = useState(note.text)
  const [kind, setKind] = useState(note.kind)
  const fresh = note.by === 'agent' && Date.now() - note.at < FRESH_MS

  useEffect(() => {
    if (editing) {
      setText(note.text)
      setKind(note.kind)
    }
  }, [editing, note])

  if (editing) {
    return (
      <li className="memory-note editing">
        <label className="sr-only" htmlFor={`memory-edit-${note.id}`}>Edit note</label>
        <textarea
          id={`memory-edit-${note.id}`}
          rows={3}
          autoFocus
          maxLength={MEMORY_LIMITS.text}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onDone(null)
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              onDone({ text, kind })
            }
          }}
        />
        <div className="memory-add-bar">
          <KindSelect value={kind} onChange={setKind} label="Kind" />
          <span className="agent-spacer" />
          <button type="button" className="memory-button" onClick={() => onDone(null)}>Cancel</button>
          <button type="button" className="memory-button primary" disabled={!text.trim()} onClick={() => onDone({ text, kind })}>Save</button>
        </div>
      </li>
    )
  }

  return (
    <li className={`memory-note${fresh ? ' fresh' : ''}`}>
      <div className="memory-meta">
        <span className={`memory-kind kind-${note.kind}`}>{KIND_LABELS[note.kind]}</span>
        {note.key ? <span className="memory-key">{note.key}</span> : null}
        <span className="agent-spacer" />
        <span className="memory-by">{note.by === 'agent' ? 'Agent' : 'You'}{note.at ? ` · ${when(note.at)}` : ''}</span>
      </div>
      <p className="memory-text">{note.text}</p>
      <div className="memory-actions">
        <button type="button" className="memory-button" onClick={onEdit} aria-label={`Edit note: ${note.text}`}>Edit</button>
        <button type="button" className="memory-button danger" onClick={onDelete} aria-label={`Delete note: ${note.text}`}>Delete</button>
      </div>
    </li>
  )
}
