import { useEffect, useRef, useState } from 'react'
import {
  ATTACHMENT_HINT,
  ATTACHMENT_SUPPORT,
  MAX_ATTACHMENTS,
  PROVIDERS,
  type AgentAttachment,
  type AgentAttachmentKind,
  type AgentAttachmentResult,
  type AgentProviderId,
} from '../../shared/agent'

export type PastedText = { text: string; lines: number }

export type AttachmentItem = AgentAttachmentResult & { id: string; pasted?: PastedText }

export const PASTE_LINE_LIMIT = 10

export const PASTE_CHAR_LIMIT = 800

export function isLongPaste(text: string): boolean {
  return text.length > PASTE_CHAR_LIMIT || text.split('\n').length > PASTE_LINE_LIMIT
}

export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function pastedMeta(pasted: PastedText, bytes: number): string {
  return `${pasted.lines} ${pasted.lines === 1 ? 'line' : 'lines'} · ${formatSize(bytes)}`
}

const KIND_NAMES: Record<AgentAttachmentKind, string> = { image: 'images', pdf: 'PDFs', text: 'text files' }

export function attachmentError(item: AttachmentItem, provider: AgentProviderId): string | null {
  if ('error' in item) return item.error
  if (!ATTACHMENT_SUPPORT[provider].includes(item.kind)) {
    return `${PROVIDERS.find((entry) => entry.id === provider)?.name ?? 'This agent'} can't read ${KIND_NAMES[item.kind]}.`
  }
  return null
}

async function resultsFromFiles(files: File[]): Promise<AgentAttachmentResult[]> {
  const withPath = files.map((file) => ({ file, path: window.suikopen.pathForFile(file) }))
  const fromDisk = await window.suikopen.agentAttach(withPath.filter((entry) => entry.path).map((entry) => entry.path))
  const fromMemory = await Promise.all(
    withPath
      .filter((entry) => !entry.path)
      .map(async ({ file }) => {
        const extension = file.type.split('/')[1] ?? 'png'
        const name = file.name && file.name !== `image.${extension}` ? file.name : `Pasted image.${extension}`
        return window.suikopen.agentAttachData(name, await file.arrayBuffer())
      })
  )
  return [...fromDisk, ...fromMemory]
}

export function useAttachments() {
  const [items, setItems] = useState<AttachmentItem[]>([])
  const [announcement, setAnnouncement] = useState('')

  function add(results: AgentAttachmentResult[]): void {
    if (results.length === 0) return
    setItems((current) => {
      const next = [...current]
      for (const result of results) {
        const full = next.filter((entry) => !('error' in entry)).length >= MAX_ATTACHMENTS
        next.push({ ...(full && !('error' in result) ? { name: result.name, error: `Max ${MAX_ATTACHMENTS} files per message.` } : result), id: crypto.randomUUID() })
      }
      return next
    })
    setAnnouncement(`${results.length} ${results.length === 1 ? 'file' : 'files'} attached.`)
  }

  async function addText(text: string): Promise<string | null> {
    const count = items.filter((entry) => entry.pasted).length
    const label = count ? `Pasted text ${count + 1}` : 'Pasted text'
    const result = await window.suikopen.agentAttachData(`${label}.txt`, new TextEncoder().encode(text).buffer as ArrayBuffer)
    const id = crypto.randomUUID()
    const item: AttachmentItem = { ...('error' in result ? result : { ...result, name: label }), id, pasted: { text, lines: text.split('\n').length } }
    setItems((current) => [...current, item])
    setAnnouncement('Long text attached as a file.')
    return id
  }

  return {
    items,
    announcement,
    addText,
    addFiles: async (files: File[]) => add(await resultsFromFiles(files)),
    pick: async () => add(await window.suikopen.agentPickAttachments()),
    remove: (id: string) => setItems((current) => current.filter((entry) => entry.id !== id)),
    clear: () => setItems([]),
  }
}

export function sendableAttachments(items: AttachmentItem[]): (AttachmentItem & AgentAttachment)[] {
  return items.filter((entry): entry is AttachmentItem & AgentAttachment => !('error' in entry))
}

function FileIcon({ kind }: { kind: AgentAttachmentKind | null }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 1.75h4.5l2.75 2.75v7.75h-7.25z" />
      <path d="M8 1.75v2.75h2.75" />
      {kind === 'pdf' ? <path d="M5.25 8.5h3.5M5.25 10h2.25" strokeLinecap="round" /> : null}
      {kind === 'text' ? <path d="M5.25 7h3.5M5.25 8.5h3.5M5.25 10h2.25" strokeLinecap="round" /> : null}
    </svg>
  )
}

function PasteIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 3.5h9M2.5 6h9M2.5 8.5h9M2.5 11h5.5" />
    </svg>
  )
}

function PastePreview({
  item,
  onClose,
  onInsert,
  onRemove,
}: {
  item: AttachmentItem & { pasted: PastedText }
  onClose: () => void
  onInsert: () => void
  onRemove: () => void
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const size = 'error' in item ? 0 : item.size

  useEffect(() => {
    ref.current?.focus()
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])

  return (
    <div
      ref={ref}
      className="paste-preview"
      role="dialog"
      aria-label={`${item.name} preview`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header>
        <strong>{item.name}</strong>
        <span>{pastedMeta(item.pasted, size)}</span>
        <button className="attach-remove" aria-label="Close preview" onClick={onClose}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <ol className="paste-lines">
        {item.pasted.text.split('\n').map((line, index) => (
          <li key={index}>{line || ' '}</li>
        ))}
      </ol>
      <footer>
        <button className="settings-button" onClick={onRemove}>
          Remove
        </button>
        <button className="settings-button primary" onClick={onInsert}>
          Insert as text
        </button>
      </footer>
    </div>
  )
}

export function AttachmentChips({
  items,
  provider,
  onRemove,
  onInsert,
}: {
  items: AttachmentItem[]
  provider: AgentProviderId
  onRemove: (id: string) => void
  onInsert: (id: string) => void
}): React.ReactElement | null {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement | null>())
  if (items.length === 0) return null
  const previewed = items.find((entry) => entry.id === previewId)

  function closePreview(): void {
    if (previewId) triggers.current.get(previewId)?.focus()
    setPreviewId(null)
  }

  return (
    <>
    {previewed?.pasted ? (
      <PastePreview
        item={previewed as AttachmentItem & { pasted: PastedText }}
        onClose={closePreview}
        onInsert={() => {
          setPreviewId(null)
          onInsert(previewed.id)
        }}
        onRemove={() => {
          setPreviewId(null)
          onRemove(previewed.id)
        }}
      />
    ) : null}
    <ul className="attach-chips" aria-label="Attached files">
      {items.map((item) => {
        const error = attachmentError(item, provider)
        const thumbnail = 'error' in item ? undefined : item.thumbnail
        const pasted = item.pasted
        if (pasted && !error) {
          const meta = pastedMeta(pasted, 'error' in item ? 0 : item.size)
          return (
            <li key={item.id} className="attach-chip">
              <button
                ref={(element) => {
                  triggers.current.set(item.id, element)
                }}
                className="attach-open"
                aria-label={`${item.name}, ${pasted.lines} lines. Open preview`}
                aria-haspopup="dialog"
                aria-expanded={previewId === item.id}
                onClick={() => setPreviewId(previewId === item.id ? null : item.id)}
              >
                <span className="attach-icon">
                  <PasteIcon />
                </span>
                <span className="attach-text">
                  <span className="attach-name">{item.name}</span>
                  <span className="attach-meta">{meta}</span>
                </span>
              </button>
              <button className="attach-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          )
        }
        return (
          <li key={item.id} className={`attach-chip${error ? ' error' : ''}`} title={error ?? item.name}>
            {thumbnail ? (
              <img className="attach-thumb" src={thumbnail} alt="" />
            ) : (
              <span className="attach-icon">
                <FileIcon kind={'error' in item ? null : item.kind} />
              </span>
            )}
            <span className="attach-text">
              <span className="attach-name">{item.name}</span>
              {error ? <span className="attach-error">{error}</span> : null}
            </span>
            <button className="attach-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        )
      })}
    </ul>
    </>
  )
}

export function SentAttachments({ items }: { items: { name: string; kind: AgentAttachmentKind; thumbnail?: string; lines?: number }[] }): React.ReactElement | null {
  if (items.length === 0) return null
  return (
    <ul className="sent-files" aria-label="Attached files">
      {items.map((item, index) => (
        <li key={index} title={item.name}>
          {item.thumbnail ? (
            <img src={item.thumbnail} alt={item.name} />
          ) : (
            <span className="sent-file">
              {item.lines ? <PasteIcon /> : <FileIcon kind={item.kind} />}
              {item.lines ? `${item.name} · ${item.lines} lines` : item.name}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files')

  return {
    over,
    handlers: {
      onDragEnter: (event: React.DragEvent) => {
        if (!hasFiles(event)) return
        depth.current += 1
        setOver(true)
      },
      onDragOver: (event: React.DragEvent) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!hasFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: (event: React.DragEvent) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        depth.current = 0
        setOver(false)
        onFiles([...event.dataTransfer.files])
      },
    },
  }
}

export function DropOverlay({ visible }: { visible: boolean }): React.ReactElement {
  return (
    <div className={`agent-drop${visible ? ' visible' : ''}`} aria-hidden={!visible}>
      <div className="agent-drop-inner">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 3v11M6.5 9.5 11 14l4.5-4.5M4 17.5h14" />
        </svg>
        <strong>Drop to attach</strong>
        <span>{ATTACHMENT_HINT}</span>
      </div>
    </div>
  )
}
