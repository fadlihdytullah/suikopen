# Grand design — multi-tab documents

Status: all four milestones built (13 of 13 tickets done). Not yet verified in the running app.
Last synced: 2026-10-29.

## Big picture

Open several `.spen` files in one window as in-app tabs. One CanvasKit and one WebGL surface draw only the
active tab; inactive tabs keep their document, history, selection and viewport as plain data. MCP and the
in-app agent always know which tab they read and write.

```
Main process                         Renderer (one window, one CanvasKit)
┌──────────────────────────┐         ┌──────────────────────────────────────────┐
│ TabRegistry (ids, paths) │◀──IPC──▶│ tabs[] = { id, store, history, selection,│
│ recovery per tab         │         │           viewport, path, dirty }        │
│ MCP server               │         │ active ──▶ Stage + Panels + rAF loop     │
│  resolveTab(call)        │──IPC──▶ │ inactive ──▶ data only, no surface       │
└──────────────────────────┘         └──────────────────────────────────────────┘

resolveTab:  tool param tabId  >  session ?tab=<id>  >  active tab
```

### What changes in existing code

- New: `src/renderer/tabs/` (tabs-store, session, router, sleep, TabBar), `src/main/tabs.ts` (registry),
  `src/main/recovery.ts` (per-tab checkpoints, session file, history vault), `list_tabs` MCP tool.
- Changed: `App.tsx` (shell stays mounted, canvas and document panels keyed by active tab), `file-session.ts` replaced by `tabs/session.ts`, recovery (per tab in M3.4),
  `bridge.ts` / `handlers.ts` (calls carry `tabId`), agent runner (MCP URL with `?tab=`), menu (tab commands).
- Module singletons made per tab in M1: `presence` (factory), `current-path` (removed), theme (swapped on activate), `image-cache` (keyed by base). `viewport-ref` stays global: it only mirrors the visible viewport.
- Riskiest: routing every MCP call to the right tab's store and queue, including tabs not mounted.
  Solved by one router in the renderer that keeps a handler per tab, independent of React.

## Concepts this rests on

- Single GPU surface, many documents: inactive views hold data, not GPU resources.
- Request routing with a precedence chain (explicit > session > default).
- Per-tab undo history and mutation queue isolation.
- Crash recovery with one checkpoint per open tab.
- Memory pressure: LRU caches and "sleeping" idle tabs.
- Accessible tabs: WAI-ARIA tablist pattern, roving tabindex.

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-29 | In-app tabs, one window, one CanvasKit | ~250MB and one WebGL context per native window or WebContentsView; we control design |
| 2026-10-29 | Agent stays bound to the tab it started in | Edits never land in the wrong file after a tab switch |
| 2026-10-29 | Paragraph caches dropped on switch, images kept in an LRU keyed by base + url | Fast switch, bounded memory |
| 2026-10-29 | No tab limit; idle tabs sleep after 10 minutes (history to disk) | Scales without a hard cap |
| 2026-10-29 | Opening an already open file focuses its tab | No duplicate stores fighting over one file |
| 2026-10-29 | Restore open tabs on launch via per-tab checkpoints | Extends recovery from #5 |
| 2026-10-29 | MCP `resolveTab`: tool `tabId` > session `?tab=` > active tab | External clients keep working; in-app agent stays pinned |
| 2026-10-29 | `list_tabs` tool; every tool response carries `{ tabId, name }` | Agent always knows which document it touched |
| 2026-10-29 | Agent may write to other tabs with explicit `tabId`; ⟳ shows on that tab | Useful cross-file work, still visible |
| 2026-10-29 | Closed or unknown `tabId` is refused, never silently rerouted | Prevents edits to the wrong document |
| 2026-10-29 | Screenshot of inactive tab renders offscreen | `renderNodePng` already offscreen |
| 2026-10-29 | Pin a tab by double-clicking it (no context menu yet) | Smallest working gesture; a context menu can come later |
| 2026-10-29 | Clean quit keeps the tab list and reopens files on launch; checkpoints only matter after a crash | Matches "restore open tabs on launch" without prompting after a normal quit |
| 2026-10-29 | Idle tabs sleep after 10 minutes (time-based, not memory pressure) | Open question in M4.2 defaulted to the recommendation; revisit if memory still grows |
| 2026-10-29 | Paragraph and label caches rely on their per-frame sweep instead of an explicit clear on switch | The sweep already frees anything the new tab does not draw |

## UX

```
┌───────────────────────────────────────────────────────────────────────┐
│ ● ● ●  ┌──────────────┐┌──────────────┐┌─────────────────┐            │
│        │ ◆ bb       × ││ ◆ landing  ● ││ ◆ Untitled    ⟳ │  +   ⌄     │
│        └──────────────┘└──────────────┘└─────────────────┘            │
├──────────────┬────────────────────────────────────────┬───────────────┤
│ Layers│Agent │  canvas: active tab only               │ Properties    │
└──────────────┴────────────────────────────────────────┴───────────────┘
●  unsaved     ⟳  agent working on this tab     ⌄  all tabs menu
```

- Tab bar 36px merged into the title bar; tabs 120–220px; middle ellipsis; folder suffix for duplicate names.
- Overflow scrolls, `⌄` lists all tabs. Drag to reorder; pin collapses to icon.
- A11y: `tablist` / `tab` / `tabpanel`, arrow keys move focus, Enter activates; ⌘T, ⌘W, ⌃Tab, ⌃⇧Tab, ⌘1–9.
  Unsaved state in the accessible name ("landing, unsaved changes"), not color alone. Close button labelled "Close landing".

| Where | Copy |
|---|---|
| Close unsaved tab | "Save changes to "landing"?" · Save / Don't save / Cancel |
| Close while agent works | "The agent is still working in "landing". Stop it and close?" · Stop and close / Cancel |
| New empty tab | "Untitled" |
| Open file already open | Focus its tab, no message |
| Open fails | "Couldn't open "x.spen": the file is damaged or isn't a SuikoPen file." |
| Tab tooltip | Full file path |

## Milestones

### M1 · Tab model and per-tab state (no UI)
Goal: the renderer holds a list of documents, each with its own store, history, selection, viewport, queue.
After: app behaves as today with one tab; open/new create tabs internally. Risk: hidden module singletons.

### M2 · Tab bar, shortcuts and close flow
Goal: visible, accessible tab bar; switching, reordering, closing with save prompts.
After: user works on several files in one window. Risk: surface rebuild cost on switch.

### M3 · MCP and agent bound to tabs, recovery per tab
Goal: `resolveTab`, `list_tabs`, `tabId` everywhere, agent pinned via `?tab=`, per-tab checkpoints, restore on launch.
After: agent edits the right file while the user browses others. Risk: calls to unmounted tabs.

### M4 · Sleeping tabs and LRU caches
Goal: bounded memory with many tabs.
After: 20+ tabs stay responsive. Risk: losing undo history when a tab sleeps.

## Tickets

| Ref | Ticket |
|---|---|
| M1.1 | Hold each open document in its own tab state — `f643b4e4` |
| M1.2 | Make viewport, presence and asset caches per tab — `b6d78103` |
| M1.3 | Track open files in main and focus an already open tab — `ddca606c` |
| M2.1 | Build the accessible tab bar — `4a6bd4a6` |
| M2.2 | Add tab shortcuts and Window menu entries — `f737bc2a` |
| M2.3 | Guard closing tabs with unsaved changes or a running agent — `4c7b9836` |
| M2.4 | Handle tab overflow, reordering and pinning — `80292d07` |
| M3.1 | Route every MCP call to a resolved tab — `620a5799` |
| M3.2 | Add the list_tabs MCP tool — `7ba1c898` |
| M3.3 | Pin in-app agent runs to their starting tab — `be897cb2` |
| M3.4 | Recover every open tab after a crash or relaunch — `1ba5f004` |
| M4.1 | Bound image memory with an LRU cache — `2dcf0a33` |
| M4.2 | Put idle tabs to sleep and wake them on demand — `524694a1` |

## Ticket log

### M1.1–M1.3 · Tab model, per-tab state, open-file registry — `f643b4e4` `b6d78103` `ddca606c`

#### Overview

M1 is the foundation: no tab bar yet, but the app stops assuming "one document". M1.1 gives each
document its own state object, M1.2 removes module-level state that would leak between documents,
M1.3 lets main know which files are open so it can refuse duplicates and, in M3, route MCP calls.

#### Educate

**1. Many documents, one GPU surface**

- Fundamental: a GPU context (WebGL) is expensive and limited; browsers cap them (~16) and drop the
  oldest. Editors with many documents keep documents as plain data and draw only the visible one.
- In this case: `Tab` holds store, selection, queue, viewport and theme. Only the active tab mounts
  `Editor` and `Stage`; switching unmounts the old Stage (its surface is deleted) and mounts the new one.
- Trade-off: remounting costs one surface build and a first paint (target < 100ms) versus keeping every
  tab mounted, which multiplies GPU memory and rAF loops.
- Check yourself: why must the store live outside React, not inside `Editor`'s `useState`?

**2. Hidden module singletons**

- Fundamental: a module-level `let` is one value per process. Fine while there is one document; a bug
  magnet once there are two, because the value silently belongs to whoever wrote it last.
- In this case: `presence` (agent glow), `current-path`, `activeTheme` and the image cache base are global.
  `viewport-ref` is also global but publishes only the visible viewport, so it can stay.
- Trade-off: move state into `Tab` (explicit, more plumbing) versus "swap on activate" (save and restore a
  global on switch: small diff, but easy to forget a value).
- Check yourself: which global stays safe with tabs, and why?

**3. One source of truth for open files**

- Fundamental: when two components can each create "the document for path X", they will eventually
  disagree. One registry owns the mapping and everyone asks it.
- In this case: main already handles Finder open, Open Recent and the Open dialog. A `TabRegistry` in
  main maps `tabId ↔ path`; opening a path that is already open returns `{ focus: tabId }`.
- Trade-off: main owns ids (needed later for MCP routing) versus renderer owns ids (simpler now, but main
  would have to learn them back).
- Check yourself: what goes wrong after "Save As" if the registry is not told the new path?

#### Design

| Decision | Options | Recommendation |
|---|---|---|
| Inactive tab | A. Unmount Editor, keep state in `Tab`; B. Keep mounted with `display: none` | A |
| Per-tab globals | A. Into `Tab` (presence, theme, viewport); B. Swap on activate | A for presence and viewport, B for theme (resolve cache already keys on theme) |
| Tab id owner | A. Main; B. Renderer | A |
| New / Open | A. Always new tab; B. Replace the active tab if it is the untouched initial document, else new tab | B, so the first open does not leave a stray "hello" tab |
| Switching without a tab bar (until M2) | A. ⌃Tab / ⌃⇧Tab and Window menu list now; B. Nothing | A, otherwise opened tabs are unreachable |
| Recovery in M1 | A. Checkpoint the active tab only; B. Per tab now | A; per tab is M3.4. Known gap: a crash loses unsaved inactive tabs |
| Window close | Ask once per dirty tab, in order | Same dialog as today; M2.3 refines copy |

#### Plan

Data shape:

```ts
type Tab = {
  id: string
  store: DocumentStore
  selection: SelectionStore
  queue: MutationQueue
  presence: Presence
  path: string | null
  assetBase: string | null
  viewport: Viewport | null
  theme: ThemeSelection
  pristine: boolean
}
type TabsState = { tabs: Tab[]; activeId: string | null }
```

Steps:

1. `src/main/tabs.ts`: `TabRegistry` (`open(path) → { id, existing }`, `rename(id, path)`, `close(id)`, `idForPath`).
2. `src/main/ipc.ts`: `openPath` asks the registry; `OpenResult` gains `tabId` and `focus`; `document:save` renames; new `tabs:closed`.
3. `src/renderer/tabs/tabs-store.ts`: `open`, `close`, `activate`, `cycle(step)`, `subscribe`; creates store, selection, queue, presence per tab.
4. `src/renderer/agent/presence.ts` becomes `createPresence()`; Stage, handlers and AgentPanel read the active tab's.
5. `current-path.ts` removed; `useActiveTab()` gives path to AgentPanel.
6. Theme saved into the tab on change, restored with `setActiveTheme` on activate.
7. `image-cache.ts`: key by `base|url`, `setAssetBase` stops clearing.
8. `Stage.tsx`: start from `tab.viewport` when present, write it back on unmount.
9. `App.tsx` and `file-session.ts`: render active tab's Editor (`key=tab.id`); New/Open/opened follow the "replace pristine or new tab" rule; window close walks dirty tabs.
10. `menu.ts`: ⌃Tab / ⌃⇧Tab and a Window menu list of tabs.

Tests:

- `test/tabs-store.spec.ts`: two tabs keep separate stores and undo; close picks the neighbour; activate/cycle.
- `test/tab-registry.spec.ts`: same path returns the existing id; rename after Save As; close frees the path.
- `test/image-cache-key.spec.ts` (or inside an existing spec): same url under two bases gives two entries.

#### Build

What changed from the plan:

- The shell is not remounted per tab. Only `Stage`, `TextEditor`, `LayersPanel` and `Inspector` are keyed by tab id;
  `AgentPanel` stays mounted so a running chat is not lost on a tab switch (the plan said "Editor per tab").
- Autosave and dirty tracking moved out of React into `tabs/session.ts`, subscribed per tab, so an inactive
  tab still autosaves.
- `OpenResult` gained `tabId` and an `existing` variant; `document:open-initial` clears the registry so a
  renderer reload never sees stale tabs.
- Window menu got Show Next/Previous Tab (⌃Tab, ⌃⇧Tab) and a checked list of tabs; the save dialog names the tab.
- MCP calls still go to the active tab. Switching tabs during an agent run sends later calls to the new tab
  until M3.3 pins runs.

Files: `src/main/tabs.ts`, `src/main/ipc.ts`, `src/main/menu.ts`, `src/preload/index.ts`,
`src/renderer/tabs/tabs-store.ts`, `src/renderer/tabs/session.ts`, `src/renderer/App.tsx`,
`src/renderer/agent/presence.ts`, `src/renderer/canvas/{Stage,paint,image-cache}.ts(x)`,
`src/renderer/mcp/handlers.ts`, `src/renderer/ui/{Panels,AgentPanel}.tsx`. Tests: `test/tabs.spec.ts`.

Recap: a tab is plain data (store, selection, queue, presence, path, viewport, theme) owned outside React.
React only renders the active one. Main owns tab ids and the path ↔ tab map.

Check yourself: after Save As in tab B to a path that tab A already has open, which tab will Finder's
"open" focus, and why?

### M2.1–M4.2 · Tab bar through sleeping tabs — `4a6bd4a6` `f737bc2a` `4c7b9836` `80292d07` `620a5799` `7ba1c898` `be897cb2` `1ba5f004` `2dcf0a33` `524694a1`

Built in one pass at the user's request; the briefs above (Big picture, UX, Decisions) served as the plan.

#### Concepts (short)

- **Request routing with a precedence chain**: the MCP server is created per HTTP request, so the session tab is
  just `?tab=` on the URL. An `AsyncLocalStorage` scope carries `tabId ?? session tab` into every tool without
  threading it through each handler. Missing tab means "the tab on screen".
- **Hibernation**: a sleeping tab keeps its document (needed to render and save) but moves undo history to disk
  and drops resolve and layout caches. Waking is lazy: on activate or on the first MCP call.
- **LRU with a byte budget**: images cost width × height × 4 bytes in WASM memory. The cache evicts the least
  recently drawn image once the total passes 256 MB and frees it with `image.delete()`.
- **Accessible tablist**: one tab in the tab order (roving tabindex), arrows move focus, Enter or Space activates,
  Delete closes; unsaved and agent state are part of the accessible name.

#### What was built

| Ticket | Result |
|---|---|
| M2.1 | `TabBar.tsx`: 36px bar in a `hiddenInset` title bar, diamond icon, middle ellipsis, folder suffix for duplicates, unsaved dot that turns into × on hover, agent spinner, tooltip with full path |
| M2.2 | ⌘T new tab, ⌘W close tab (⇧⌘W closes the window), ⌃Tab / ⌃⇧Tab, ⌘1–8 and ⌘9 for the last tab, Window menu lists tabs |
| M2.3 | Closing asks "Save changes to "name"?" (Save / Don't Save / Cancel) and "The agent is still working in "name". Stop it and close?"; window close walks every dirty tab; empty state with New file and Open… |
| M2.4 | Overflow scrolls, `⌄` listbox of all tabs, drag to reorder, double-click to pin, middle-click to close, switch time warned in the console above 100 ms |
| M3.1 | `tabId` on every document tool, `resolveTabId` (explicit > session), router refuses closed tabs, results end with `Tab: "name" (id)`, theme and screen rect resolved per tab, window screenshot refused for an off-screen tab |
| M3.2 | `list_tabs` (`id, name, path, active, dirty, agentBusy`); core guide explains tabs |
| M3.3 | In-app runs send the tab; Claude, Codex and Gemini get `MCP_URL?tab=<id>` and a prompt line naming the tab |
| M3.4 | `userData/recovery/<tabId>.json` per tab plus `session.json`; launch restores every tab, asks Restore / Discard only if a crash left unsaved changes; a renderer reload restores silently from memory |
| M4.1 | `createLru` in `image-cache.ts`, 256 MB budget |
| M4.2 | `sleep.ts`: history spilled to `userData/history/<tabId>.json` after 10 idle minutes, restored on wake |

#### What changed from the plan

- Pinning is a double-click, not a context menu.
- Chat history was already stored per file path, so "chat history per tab" needed no change.
- `⟳` also shows for 3 seconds on any tab an agent writes to with an explicit `tabId`, not only the tab it started in.
- Main-process stores for recovery and history are created lazily, so main modules can be imported in tests.

Tests: `test/tabs.spec.ts`, `test/tabs-m2-m4.spec.ts` (pin and reorder, labels, routing to an inactive tab and
refusing a closed one, recovery files, history vault, LRU eviction, sleep and wake with full undo).

Recap: a tab is plain data owned outside React; one router sends every agent call to a tab's own store and
queue; main owns tab ids, the open-file map, per-tab recovery and spilled history.

Check yourself: an external Claude Code session (no `?tab=`) calls `update_node` while the user switches tabs
halfway through a batch. Which document receives the edit, and what would make it deterministic?

### Fix · Free CanvasKit surface memory (2026-10-29)
- Symptom: "RuntimeError: Aborted()" with heap 2048MB, canvas recovery failed, renderer reloaded and the streaming chat reply was lost.
- Measured in a debug instance: each `render_node` (agent screenshot) of a 1440×900 frame grew the WASM heap by ~20MB and never gave it back (128MB → 1043MB after 50 screenshots). Text edits and tab switches did not grow it.
- Root cause: `Surface.delete()` does not free a raster surface's pixel buffer, nor a WebGL surface's GrContext. `Surface.dispose()` does.
- Fix: `dispose()` in `renderNodePng` and `wrapSurface`; screenshot size capped (4096px side, 8M pixels); chat saved every 1.5s while the agent streams. After the fix: 50 screenshots and 30 tab switches stay at 128MB.
- Check yourself: why did the leak show up only when an agent worked, not when you edited by hand?
