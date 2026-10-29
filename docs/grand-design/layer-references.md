# Grand design — layer references in the agent prompt

Status: built (1 of 1 ticket done). Chip checked in a debug instance; not yet sent to a real provider.
Last synced: 2026-10-29.

## Big picture

The canvas selection shows as a chip in the agent prompt box, like Pen: one layer shows its type icon and
name, several show "N layers" with the names on hover. On send the selection is frozen and appended to the
prompt as a short list (name, type, id, size); the sent bubble keeps the chip.

```
tab.selection ──▶ useSelectedLayers ──▶ chip [# Form / Welcome ×]
                                         │ send
                                         ▼
prompt + layersBlock(refs) ──▶ agent ──▶ get_node / screenshot for detail
```

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-29 | Chip follows the live canvas selection, × drops it for that selection | Same as Pen, zero extra clicks |
| 2026-10-29 | Send id + name + type + size, not node JSON or screenshots | Cheap; agent fetches detail with tools |
| 2026-10-29 | Freeze at send | Selection may change while the agent works |
| 2026-10-29 | @mention left out | Not needed yet |

## Concepts

**Context by reference**
- Fundamental: send a pointer (id, name, size) and let the agent fetch detail on demand, instead of pasting whole objects into the prompt.
- In this case: `layersBlock` lists up to 50 layers; the agent calls `get_node` or `screenshot` for what it needs.
- Trade-off: one extra tool call per detail, but the prompt stays small for big selections.
- Check yourself: why not attach a screenshot of every selected layer?

**Snapshot at send**
- Fundamental: freeze inputs at the moment of the action so later changes do not change its meaning.
- In this case: the selection is copied into the prompt and chat entry when you press send; selecting other layers while the agent works changes nothing.
- Trade-off: if you change the selection mid-run, the agent still works on the old one.
- Check yourself: what would "this" mean to the agent if the selection were read live?

**Derived state from external stores**
- Fundamental: `useSyncExternalStore` lets React read a store outside React and re-render when it changes.
- In this case: `useSelectedLayers` subscribes to the tab's selection and document so the chip updates as you click on the canvas.
- Trade-off: two subscriptions per panel; cheap because the result is memoised.
- Check yourself: why subscribe to the document too, not only to the selection?

## Ticket list

| Ref | Title |
|---|---|
| fff09a6c | Feature · Attach selected layers to the agent prompt |

## Ticket log

### fff09a6c · Attach selected layers to the agent prompt
- `src/renderer/ui/LayerRefs.tsx`: `useSelectedLayers(tab)` (selection + document via `useSyncExternalStore`, resolved sizes), `LayerChip`, `layersKey`.
- `src/shared/agent.ts`: `LayerRef`, `layersBlock()` (max 50 listed, names clipped), `layers` on user chat entries.
- AgentPanel: chip above the input, × stores the dropped selection key, chip in the sent bubble.
- Test: `test/memory.spec.ts` › layer references.
- Check yourself: why is the dropped state a selection key instead of a boolean?
