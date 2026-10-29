import { useMemo, useSyncExternalStore } from 'react'
import type { LayerRef } from '../../shared/agent'
import { resolvedDocument } from '../document/current'
import { itemById } from '../canvas/scene-index'
import type { Tab } from '../tabs/tabs-store'

const EMPTY = new Set<string>()
const idle = () => () => {}

export function useSelectedLayers(tab: Tab | null): LayerRef[] {
  const selected = useSyncExternalStore(tab ? tab.selection.subscribe : idle, tab ? tab.selection.getState : () => EMPTY)
  const document = useSyncExternalStore(tab ? tab.store.subscribe : idle, tab ? tab.store.getState : () => null)
  return useMemo(() => {
    if (!tab || !document || selected.size === 0) return []
    const resolvedDoc = resolvedDocument(tab.store)
    return [...selected].flatMap((id) => {
      const item = itemById(resolvedDoc, id)
      return item ? [{ id, name: item.node.name ?? item.node.type, type: item.node.type, width: Math.round(item.width), height: Math.round(item.height) }] : []
    })
  }, [tab, document, selected])
}

export function layersKey(layers: readonly Pick<LayerRef, 'id'>[]): string {
  return layers.map((layer) => layer.id).join('|')
}

function LayerIcon({ type }: { type: string | null }): React.ReactElement {
  const paths: Record<string, React.ReactNode> = {
    frame: <path d="M4 1.5v11M10 1.5v11M1.5 4h11M1.5 10h11" />,
    text: <path d="M3 3h8M7 3v8" />,
    rectangle: <rect x="2.5" y="2.5" width="9" height="9" rx="1" />,
    ellipse: <circle cx="7" cy="7" r="4.5" />,
    ref: <path d="M7 2 12 7 7 12 2 7z" />,
    many: <path d="M7 2 12.5 4.75 7 7.5 1.5 4.75zM1.5 7.25 7 10l5.5-2.75M1.5 9.75 7 12.5l5.5-2.75" />,
  }
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[type ?? 'many'] ?? paths['rectangle']}
    </svg>
  )
}

export function LayerChip({ layers, onRemove }: { layers: readonly Pick<LayerRef, 'name' | 'type'>[]; onRemove?: () => void }): React.ReactElement | null {
  if (layers.length === 0) return null
  const single = layers.length === 1 ? layers[0]! : null
  const label = single ? single.name : `${layers.length} layers`
  const names = layers.map((layer) => layer.name).join('\n')
  return (
    <span className={`layer-chip${onRemove ? ' removable' : ''}`} title={names}>
      <LayerIcon type={single ? single.type : null} />
      <span className="layer-chip-name">{label}</span>
      {onRemove ? (
        <button type="button" aria-label={`Don't send ${label} with this message`} onClick={onRemove}>
          ×
        </button>
      ) : null}
    </span>
  )
}
