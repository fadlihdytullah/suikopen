import { useSyncExternalStore } from 'react'
import type { Document, Variable } from '../../shared/schema/document'
import {
  asNumber,
  hasChildren,
  toArray,
  type EffectValue,
  type FillValue,
  type Node,
  type PaddingValue,
  type SizingValue,
} from '../../shared/schema/node'
import { itemById } from '../canvas/scene-index'
import { resolvedDocument, resolveError } from '../document/current'
import { resolveValue } from '../document/resolve'
import { activeTheme, setActiveTheme, subscribeTheme } from '../document/resolved'
import { detachInstance, setNodeProps, updateNodes } from '../store/mutations'
import { useDocument, useDocumentStore, useSelection, useSelectionStore } from '../store/use-store'
import { ColorField } from './controls/ColorField'
import { NumberField } from './controls/NumberField'
import { Segmented } from './controls/Segmented'
import { SelectField } from './controls/SelectField'
import { DEFAULT_FAMILY } from '../text/font-manager'
import { layerName, TypeIcon } from './LayersPanel'

type Common<T> = { value: T | null; mixed: boolean }
type SizeMode = 'fixed' | 'hug' | 'fill'

const FONT_FAMILIES = ['Arial', 'Inter', 'SF Pro Text', 'Helvetica Neue', 'Georgia', 'Times New Roman', 'Menlo', 'JetBrains Mono'].filter((family, index, list) => list.indexOf(family) === index)
const WEIGHTS = [
  ['100', 'Thin'],
  ['200', 'Extra light'],
  ['300', 'Light'],
  ['400', 'Regular'],
  ['500', 'Medium'],
  ['600', 'Semibold'],
  ['700', 'Bold'],
  ['800', 'Extra bold'],
  ['900', 'Black'],
] as const

function common<T>(values: T[]): Common<T> {
  if (values.length === 0) {
    return { value: null, mixed: false }
  }
  const first = values[0]!
  const same = values.every((value) => JSON.stringify(value) === JSON.stringify(first))
  return { value: same ? first : null, mixed: !same }
}

function findNode(nodes: Node[], id: string): Node | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    if (hasChildren(node)) {
      const found = findNode(node.children, id)
      if (found) {
        return found
      }
    }
  }
  return undefined
}

function sizeMode(value: SizingValue): SizeMode {
  if (typeof value === 'number') return 'fixed'
  return value.startsWith('fill') ? 'fill' : 'hug'
}

function paddingBox(value: PaddingValue | undefined): [number, number, number, number] {
  if (value === undefined) return [0, 0, 0, 0]
  if (typeof value === 'number') return [value, value, value, value]
  if (value.length === 2) return [value[0], value[1], value[0], value[1]]
  return value
}

function packPadding([top, right, bottom, left]: [number, number, number, number]): PaddingValue {
  if (top === bottom && left === right) {
    return top === left ? top : [top, left]
  }
  return [top, right, bottom, left]
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: { label: string; icon: 'plus' | 'minus'; onClick: () => void }
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <section className="prop-section" aria-label={title}>
      <header className="prop-section-head">
        <h3>{title}</h3>
        {action ? (
          <button className="icon-button small" aria-label={action.label} title={action.label} onClick={action.onClick}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d={action.icon === 'plus' ? 'M6 2.5v7M2.5 6h7' : 'M2.5 6h7'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </header>
      {children}
    </section>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <button className="icon-button small" aria-label={label} title={label} onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function Arrow({ direction }: { direction: 'down' | 'right' }): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={direction === 'down' ? 'M6 2v8M3 7l3 3 3-3' : 'M2 6h8M7 3l3 3-3 3'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DocumentPanel({ document }: { document: Document }): React.ReactElement {
  const theme = useSyncExternalStore(subscribeTheme, activeTheme)
  const axes = Object.entries(document.themes ?? {})
  const variables = Object.entries(document.variables ?? {})

  return (
    <>
      {axes.length ? (
        <Section title="Theme">
          {axes.map(([axis, options]) => (
            <SelectField
              key={axis}
              label={axis}
              options={options}
              value={theme[axis] ?? options[0] ?? null}
              onCommit={(option) => setActiveTheme({ ...theme, [axis]: option })}
            />
          ))}
        </Section>
      ) : null}
      {variables.length ? (
        <Section title={`Variables · ${variables.length}`}>
          <ul className="variable-list">
            {variables.map(([name, variable]) => {
              const value = resolveValue(`$${name}`, document.variables ?? {}, theme)
              return (
                <li key={name}>
                  {variable.type === 'color' ? <span className="color-dot" style={{ background: String(value) }} /> : <span className="variable-type">{variable.type.slice(0, 3)}</span>}
                  <span className="variable-name">{name}</span>
                  <span className="variable-value">{String(value)}</span>
                </li>
              )
            })}
          </ul>
        </Section>
      ) : null}
      <p className="inspector-empty">Select a layer to edit its properties.</p>
    </>
  )
}

export function Inspector(): React.ReactElement {
  const store = useDocumentStore()
  const selectionStore = useSelectionStore()
  const raw = useDocument()
  const resolved = resolvedDocument(store)
  const error = resolveError(store)
  const selection = useSelection()
  const theme = useSyncExternalStore(subscribeTheme, activeTheme)
  const variables: Record<string, Variable> = raw.variables ?? {}
  const nodes = [...selection].map((id) => findNode(raw.children, id)).filter((node): node is Node => !!node)
  const errorNote = error === null ? null : <p className="inspector-error" role="alert">{error}</p>

  if (nodes.length === 0) {
    const insideInstance = [...selection].some((id) => id.includes('/'))
    return (
      <div className="inspector">
        {errorNote}
        {insideInstance ? (
          <p className="inspector-empty">
            This layer is inside a component instance. Select the instance to detach it, or edit the main component.
          </p>
        ) : (
          <DocumentPanel document={raw} />
        )}
      </div>
    )
  }

  const ids = nodes.map((node) => node.id)
  const items = ids.map((id) => itemById(resolved, id))
  const token = (value: unknown) => resolveValue(value, variables, theme)
  const set = (label: string, patch: Record<string, unknown>) => setNodeProps(store, label, ids, patch)
  const eachNode = (label: string, patch: (node: Node) => Record<string, unknown>) => {
    store.beginGesture(label)
    nodes.forEach((node) => setNodeProps(store, label, [node.id], patch(node)))
    store.endGesture()
  }
  const scrub = (label: string) => ({ onScrubStart: () => store.beginGesture(label), onScrubEnd: () => store.endGesture() })

  const single = nodes.length === 1 ? nodes[0]! : null
  const frames = nodes.filter((node) => node.type === 'frame')
  const allFrames = frames.length === nodes.length
  const texts = nodes.filter((node) => node.type === 'text')
  const allTexts = texts.length === nodes.length
  const inLayout = items.every((item) => item?.parent?.type === 'frame' && (item.parent.layout ?? 'none') !== 'none')
  const canHug = nodes.every((node) => node.type === 'frame' || node.type === 'text' || node.type === 'group')
  const cornered = nodes.every((node) => node.type === 'frame' || node.type === 'rectangle')

  const sizeRow = (key: 'width' | 'height') => {
    const mode = common(nodes.map((node) => sizeMode(node[key])))
    const measured = common(items.map((item) => (item ? Math.round(item[key] * 100) / 100 : null)))
    const options: { value: SizeMode; label: string }[] = [
      { value: 'fixed', label: 'Fixed' },
      ...(canHug ? [{ value: 'hug' as const, label: 'Hug' }] : []),
      ...(inLayout ? [{ value: 'fill' as const, label: 'Fill' }] : []),
    ]
    return (
      <div className="size-row">
        <NumberField
          label={key === 'width' ? 'W' : 'H'}
          title={key === 'width' ? 'Width' : 'Height'}
          min={0}
          value={measured.value}
          mixed={measured.mixed}
          onCommit={(value) => updateNodes(store, `Set ${key}`, new Map(ids.map((id) => [id, { [key]: value }])))}
          {...scrub(`Set ${key}`)}
        />
        <select
          className="size-mode"
          aria-label={`${key === 'width' ? 'Width' : 'Height'} sizing`}
          value={mode.mixed ? '' : (mode.value ?? 'fixed')}
          onChange={(event) => {
            const next = event.target.value as SizeMode
            eachNode(`Set ${key} sizing`, (node) => {
              const item = items[ids.indexOf(node.id)]
              return { [key]: next === 'hug' ? 'fit_content' : next === 'fill' ? 'fill_container' : Math.round(item?.[key] ?? 100) }
            })
          }}
        >
          {mode.mixed ? <option value="">Mixed</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const fills = common(nodes.map((node) => toArray(node.fill)))
  const writeFills = (next: FillValue[]) => set('Set fill', { fill: next.length === 0 ? undefined : next.length === 1 ? next[0] : next })

  const fillRow = (fill: FillValue, index: number, list: FillValue[]) => {
    const replace = (value: FillValue) => writeFills(list.map((entry, position) => (position === index ? value : entry)))
    const remove = () => writeFills(list.filter((_, position) => position !== index))

    if (typeof fill === 'string' || fill.type === 'color') {
      const color = typeof fill === 'string' ? fill : fill.color
      return (
        <div className="prop-row" key={index}>
          <ColorField
            label="Fill"
            value={color}
            resolved={String(token(color))}
            onCommit={(next) => replace(typeof fill === 'string' ? next : { ...fill, color: next })}
            onDetach={() => replace(String(token(color)))}
          />
          <RemoveButton label="Remove fill" onClick={remove} />
        </div>
      )
    }

    const preview =
      fill.type === 'gradient'
        ? `linear-gradient(${(fill.rotation ?? 0) + 90}deg, ${fill.colors.map((stop) => `${String(token(stop.color))} ${stop.position * 100}%`).join(', ')})`
        : '#3a3e46'
    return (
      <div className="prop-row" key={index}>
        <div className="color-field">
          <span className="color-swatch" style={{ background: preview }} />
          <span className="prop-text">
            {fill.type === 'gradient' ? `${(fill.gradientType ?? 'linear').replace(/^./, (letter) => letter.toUpperCase())} gradient` : 'Image'}
          </span>
        </div>
        <RemoveButton label="Remove fill" onClick={remove} />
      </div>
    )
  }

  const strokes = common(nodes.map((node) => node.stroke ?? null))
  const stroke = strokes.value
  const effects = common(nodes.map((node) => toArray(node.effect)))
  const writeEffects = (next: EffectValue[]) => set('Set effects', { effect: next.length === 0 ? undefined : next.length === 1 ? next[0] : next })

  const ref = single?.type === 'ref' ? single : null
  const master = ref ? findNode(raw.children, ref.masterId) : undefined

  const layoutValue = common(frames.map((node) => (node.type === 'frame' ? (node.layout ?? 'none') : 'none')))
  const hasLayout = allFrames && layoutValue.value !== null && layoutValue.value !== 'none'
  const frame = allFrames && nodes.length === 1 && single?.type === 'frame' ? single : null
  const padding = frame ? paddingBox(frame.padding) : null

  return (
    <div className="inspector">
      {errorNote}
      <header className="inspector-head">
        {single ? <TypeIcon node={single} /> : null}
        {single ? (
          <input
            key={single.id}
            className="inspector-name"
            aria-label="Layer name"
            defaultValue={layerName(single, (id) => findNode(raw.children, id))}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim()
              if (name && name !== layerName(single, (id) => findNode(raw.children, id))) set('Rename layer', { name })
            }}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          />
        ) : (
          <span className="inspector-name">{nodes.length} layers</span>
        )}
      </header>

      {ref ? (
        <Section title="Instance">
          <p className="prop-note">
            Instance of <strong>{master ? layerName(master) : ref.masterId}</strong>
          </p>
          <div className="prop-actions">
            {master ? (
              <button className="text-button" onClick={() => selectionStore.set([master.id])}>
                Go to main component
              </button>
            ) : null}
            <button
              className="text-button"
              onClick={() => {
                const expanded = items[0]?.node
                if (expanded) detachInstance(store, ref.id, expanded)
              }}
            >
              Detach instance
            </button>
          </div>
        </Section>
      ) : null}

      <Section title="Position">
        <div className="prop-grid">
          <NumberField
            label="X"
            title={inLayout ? 'Set by the parent’s auto layout' : 'X'}
            disabled={inLayout}
            {...common(nodes.map((node) => node.x))}
            onCommit={(x) => updateNodes(store, 'Set x', new Map(ids.map((id) => [id, { x }])))}
            {...scrub('Set x')}
          />
          <NumberField
            label="Y"
            title={inLayout ? 'Set by the parent’s auto layout' : 'Y'}
            disabled={inLayout}
            {...common(nodes.map((node) => node.y))}
            onCommit={(y) => updateNodes(store, 'Set y', new Map(ids.map((id) => [id, { y }])))}
            {...scrub('Set y')}
          />
        </div>
      </Section>

      <Section title="Size">
        <div className="prop-stack">
          {sizeRow('width')}
          {sizeRow('height')}
        </div>
      </Section>

      {allFrames ? (
        <Section
          title="Auto layout"
          action={
            hasLayout
              ? { label: 'Remove auto layout', icon: 'minus', onClick: () => set('Remove auto layout', { layout: 'none' }) }
              : { label: 'Add auto layout', icon: 'plus', onClick: () => set('Add auto layout', { layout: 'vertical' }) }
          }
        >
          {hasLayout ? (
            <>
              <div className="prop-grid">
                <Segmented
                  label="Direction"
                  value={layoutValue.value as 'vertical' | 'horizontal' | null}
                  options={[
                    { value: 'vertical', label: 'Vertical', icon: <Arrow direction="down" /> },
                    { value: 'horizontal', label: 'Horizontal', icon: <Arrow direction="right" /> },
                  ]}
                  onChange={(layout) => set('Set direction', { layout })}
                />
                <NumberField
                  label="Gap"
                  title="Gap between items"
                  min={0}
                  {...common(frames.map((node) => (node.type === 'frame' ? asNumber(token(node.gap)) : 0)))}
                  onCommit={(gap) => set('Set gap', { gap })}
                  {...scrub('Set gap')}
                />
              </div>
              {padding ? (
                <div className="prop-grid">
                  <NumberField
                    label="↔"
                    title="Horizontal padding"
                    min={0}
                    value={padding[1] === padding[3] ? padding[3] : null}
                    mixed={padding[1] !== padding[3]}
                    onCommit={(value) => set('Set padding', { padding: packPadding([padding[0], value, padding[2], value]) })}
                    {...scrub('Set padding')}
                  />
                  <NumberField
                    label="↕"
                    title="Vertical padding"
                    min={0}
                    value={padding[0] === padding[2] ? padding[0] : null}
                    mixed={padding[0] !== padding[2]}
                    onCommit={(value) => set('Set padding', { padding: packPadding([value, padding[1], value, padding[3]]) })}
                    {...scrub('Set padding')}
                  />
                </div>
              ) : null}
              {frame ? <AlignmentGrid frame={frame} onChange={(patch) => set('Set alignment', patch)} /> : null}
            </>
          ) : (
            <p className="prop-note">Stack children in a row or column with gap and padding.</p>
          )}
        </Section>
      ) : null}

      {cornered ? (
        <Section title="Appearance">
          <div className="prop-grid">
            <NumberField
              label={
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 10V5a3 3 0 0 1 3-3h5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              }
              title="Corner radius"
              min={0}
              {...common(
                nodes.map((node) => {
                  const radius = 'cornerRadius' in node ? token(node.cornerRadius) : 0
                  return Array.isArray(radius) ? asNumber(radius[0]) : asNumber(radius)
                })
              )}
              onCommit={(cornerRadius) => set('Set corner radius', { cornerRadius })}
              {...scrub('Set corner radius')}
            />
          </div>
        </Section>
      ) : null}

      <Section
        title="Fill"
        action={{ label: 'Add fill', icon: 'plus', onClick: () => writeFills([...(fills.value ?? []), '#D9D9D9']) }}
      >
        {fills.mixed ? <p className="prop-note">Mixed fills. Add a fill to replace them all.</p> : (fills.value ?? []).map((fill, index, list) => fillRow(fill, index, list))}
      </Section>

      <Section
        title="Stroke"
        action={
          stroke || strokes.mixed
            ? undefined
            : { label: 'Add stroke', icon: 'plus', onClick: () => set('Add stroke', { stroke: { color: '#000000', width: 1, align: 'inside' } }) }
        }
      >
        {strokes.mixed ? <p className="prop-note">Mixed strokes.</p> : null}
        {stroke ? (
          <>
            <div className="prop-row">
              <ColorField
                label="Stroke"
                value={stroke.color}
                resolved={String(token(stroke.color))}
                onCommit={(color) => set('Set stroke', { stroke: { ...stroke, color } })}
                onDetach={() => set('Set stroke', { stroke: { ...stroke, color: String(token(stroke.color)) } })}
              />
              <RemoveButton label="Remove stroke" onClick={() => set('Remove stroke', { stroke: undefined })} />
            </div>
            <div className="prop-grid">
              <NumberField
                label="W"
                title="Stroke width"
                min={0}
                value={stroke.width ?? 1}
                onCommit={(width) => set('Set stroke width', { stroke: { ...stroke, width } })}
                {...scrub('Set stroke width')}
              />
              <select
                className="size-mode wide"
                aria-label="Stroke position"
                value={stroke.align ?? 'inside'}
                onChange={(event) => set('Set stroke position', { stroke: { ...stroke, align: event.target.value } })}
              >
                <option value="inside">Inside</option>
                <option value="center">Center</option>
                <option value="outside">Outside</option>
              </select>
            </div>
          </>
        ) : null}
      </Section>

      <Section
        title="Effects"
        action={{
          label: 'Add effect',
          icon: 'plus',
          onClick: () =>
            writeEffects([...(effects.value ?? []), { type: 'shadow', shadowType: 'outer', offset: { x: 0, y: 4 }, blur: 12, color: '#00000040' }]),
        }}
      >
        {effects.mixed ? <p className="prop-note">Mixed effects.</p> : null}
        {(effects.value ?? []).map((effect, index, list) => {
          const replace = (value: EffectValue) => writeEffects(list.map((entry, position) => (position === index ? value : entry)))
          return (
            <div className="effect" key={index}>
              <div className="prop-row">
                <select
                  className="size-mode wide grow"
                  aria-label="Effect type"
                  value={effect.type === 'blur' ? 'blur' : (effect.shadowType ?? 'outer')}
                  onChange={(event) => {
                    const kind = event.target.value
                    replace(
                      kind === 'blur'
                        ? { type: 'blur', radius: effect.type === 'blur' ? effect.radius : 8 }
                        : { ...(effect.type === 'shadow' ? effect : { offset: { x: 0, y: 4 }, blur: 12, color: '#00000040' }), type: 'shadow', shadowType: kind as 'inner' | 'outer' }
                    )
                  }}
                >
                  <option value="outer">Drop shadow</option>
                  <option value="inner">Inner shadow</option>
                  <option value="blur">Layer blur</option>
                </select>
                <RemoveButton label="Remove effect" onClick={() => writeEffects(list.filter((_, position) => position !== index))} />
              </div>
              {effect.type === 'blur' ? (
                <div className="prop-grid">
                  <NumberField label="Blur" min={0} value={effect.radius} onCommit={(radius) => replace({ ...effect, radius })} {...scrub('Set blur')} />
                </div>
              ) : (
                <>
                  <div className="prop-grid three">
                    <NumberField label="X" value={effect.offset?.x ?? 0} onCommit={(x) => replace({ ...effect, offset: { x, y: effect.offset?.y ?? 0 } })} {...scrub('Set shadow')} />
                    <NumberField label="Y" value={effect.offset?.y ?? 0} onCommit={(y) => replace({ ...effect, offset: { x: effect.offset?.x ?? 0, y } })} {...scrub('Set shadow')} />
                    <NumberField label="B" title="Blur" min={0} value={effect.blur ?? 0} onCommit={(blur) => replace({ ...effect, blur })} {...scrub('Set shadow')} />
                  </div>
                  <ColorField
                    label="Shadow"
                    value={effect.color ?? '#00000040'}
                    resolved={String(token(effect.color ?? '#00000040'))}
                    onCommit={(color) => replace({ ...effect, color })}
                    onDetach={() => replace({ ...effect, color: String(token(effect.color)) })}
                  />
                </>
              )}
            </div>
          )
        })}
      </Section>

      {allTexts ? (
        <Section title="Text">
          <input
            className="field-input full"
            list="font-families"
            aria-label="Font family"
            placeholder="Font family"
            key={ids.join()}
            defaultValue={common(texts.map((node) => (node.type === 'text' ? String(token(node.fontFamily ?? DEFAULT_FAMILY)) : ''))).value ?? ''}
            onBlur={(event) => {
              const fontFamily = event.currentTarget.value.trim()
              if (fontFamily) set('Set font', { fontFamily })
            }}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          />
          <datalist id="font-families">
            {FONT_FAMILIES.map((family) => (
              <option key={family} value={family} />
            ))}
          </datalist>
          <div className="prop-grid">
            <select
              className="size-mode wide"
              aria-label="Font weight"
              value={(() => {
                const weight = common(texts.map((node) => (node.type === 'text' ? (node.fontWeight ?? 400) : 400)))
                return weight.mixed ? '' : String(weight.value)
              })()}
              onChange={(event) => set('Set font weight', { fontWeight: Number(event.target.value) })}
            >
              <option value="" disabled hidden>
                Mixed
              </option>
              {WEIGHTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <NumberField
              label="Size"
              title="Font size"
              min={1}
              {...common(texts.map((node) => (node.type === 'text' ? asNumber(token(node.fontSize), 16) : 16)))}
              onCommit={(fontSize) => set('Set font size', { fontSize })}
              {...scrub('Set font size')}
            />
          </div>
          <div className="prop-grid">
            <NumberField
              label="LH"
              title="Line height (multiplier)"
              step={0.05}
              min={0.5}
              {...common(texts.map((node) => (node.type === 'text' ? (node.lineHeight ?? 1.2) : 1.2)))}
              onCommit={(lineHeight) => set('Set line height', { lineHeight: Math.round(lineHeight * 100) / 100 })}
            />
            <NumberField
              label="LS"
              title="Letter spacing"
              step={0.1}
              {...common(texts.map((node) => (node.type === 'text' ? (node.letterSpacing ?? 0) : 0)))}
              onCommit={(letterSpacing) => set('Set letter spacing', { letterSpacing })}
            />
          </div>
          <Segmented
            label="Text align"
            value={common(texts.map((node) => (node.type === 'text' ? (node.textAlign ?? 'left') : 'left'))).value}
            options={(['left', 'center', 'right'] as const).map((value) => ({
              value,
              label: `Align ${value}`,
              icon: (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d={value === 'left' ? 'M2 3h8M2 6h5M2 9h7' : value === 'center' ? 'M2 3h8M3.5 6h5M2.5 9h7' : 'M2 3h8M5 6h5M3 9h7'}
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              ),
            }))}
            onChange={(textAlign) => set('Set text align', { textAlign })}
          />
        </Section>
      ) : null}
    </div>
  )
}

function AlignmentGrid({
  frame,
  onChange,
}: {
  frame: Extract<Node, { type: 'frame' }>
  onChange: (patch: Record<string, unknown>) => void
}): React.ReactElement {
  const vertical = frame.layout === 'vertical'
  const justify = frame.justifyContent ?? 'start'
  const align = frame.alignItems ?? 'start'
  const spaced = justify === 'space_between' || justify === 'space_around'
  const positions = ['start', 'center', 'end'] as const
  const names = { start: vertical ? 'top' : 'left', center: 'center', end: vertical ? 'bottom' : 'right' }
  const crossNames = { start: vertical ? 'left' : 'top', center: 'center', end: vertical ? 'right' : 'bottom' }

  return (
    <div className="align-row">
      <div className="align-grid" role="radiogroup" aria-label="Alignment">
        {positions.map((row) =>
          positions.map((column) => {
            const main = vertical ? row : column
            const cross = vertical ? column : row
            const active = (spaced || justify === main) && align === cross
            return (
              <button
                key={`${row}-${column}`}
                role="radio"
                aria-checked={active && !spaced}
                aria-label={`Align ${names[main]} ${crossNames[cross]}`.replace('center center', 'center')}
                className={active ? 'active' : ''}
                onClick={() => onChange({ justifyContent: spaced ? justify : main, alignItems: cross })}
              >
                <span />
              </button>
            )
          })
        )}
      </div>
      <button
        className={`text-button toggle${spaced ? ' on' : ''}`}
        aria-pressed={spaced}
        onClick={() => onChange({ justifyContent: spaced ? 'start' : 'space_between' })}
      >
        Space between
      </button>
    </div>
  )
}
