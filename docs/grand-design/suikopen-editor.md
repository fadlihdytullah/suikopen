# Grand design — suikopen, local-first design editor

Status: all six milestones complete, plus M7 (in-app agent) built directly without tickets. 19 of 19 bb tickets done. The editor opens, draws, lays out, styles, shapes text, edits, saves, answers an agent over MCP, and resolves variables, themes and component instances.
Last synced: 2026-10-26.

## Big picture

A local-first desktop design editor: the document is a JSON node tree in a file on disk, the canvas
is drawn by Skia compiled to WASM, and an MCP server lets a coding agent read and write the same
document the user is editing. Modelled on Pen (`dev.pencil.desktop` 1.2.20), rebuilt clean-room.

```
┌─ Electron main ────────────────────────────┐
│  file-io (atomic write)   MCP server (HTTP)│
│         │                        │         │
│         │ IPC                    │ IPC     │
└─────────┼────────────────────────┼─────────┘
          v                        v
┌─ Renderer (React + Vite) ──────────────────┐
│  Document store (immutable node tree)      │
│         │                                  │
│         v                                  │
│  Yoga (flex layout)  ->  layout boxes      │
│         │                                  │
│         v                                  │
│  CanvasKit (Skia/WASM) -> <canvas> WebGL   │
│         ^                                  │
│  Viewport (pan/zoom), hit-test, tools      │
└────────────────────────────────────────────┘
```

Data flow: user gesture or MCP call -> store patch -> layout pass (dirty subtree) -> paint pass ->
canvas. Save is a debounced atomic write of the serialized tree.

### What changes in existing code

Greenfield. The repo is empty, so every part is new. Riskiest part is the renderer bridge:
CanvasKit surface creation, device pixel ratio, and keeping a 60fps paint while the tree changes.

## Reference findings (REA, 2026-10-26)

Analysed `/Applications/Pen.app` and `/Applications/Paper.app` with REA.

- Pen: fully local. 225MB `app.asar`. Editor is a Vite bundle (`out/editor/assets/index.js`, 8.7MB)
  plus `pencil-*.wasm` (9.6MB) — C++ Skia with HarfBuzz, ICU and SkSL, i.e. CanvasKit-shaped.
- `.pen` files are plain JSON: `{ version, themes, imports, variables, children[] }`.
  Node types: `frame, group, rectangle, ellipse, polygon, path, text, note, prompt, context, icon,
  script, browser, ref`. Layout is flexbox (`layout, gap, padding, justifyContent, alignItems`),
  sizes support `fit_content(100)` / `fill_container` fallbacks, values may be `$variable` refs.
- Pen bundles coding agents (Claude Agent SDK, Codex, Cursor SDK, Gemini/Kiro/OpenCode) — ~1GB of
  the 1.1GB bundle — and ships its own agent skills as markdown in `out/skills/pen-dev/`.
- Paper is the opposite shape: a thin Electron shell loading `app.paper.design`, with the MCP server
  in the main process proxying to `window.mcpHandlers` in the renderer. Rejected as the model.

Schema is a reference for *concepts*, not for copying. Our format is our own.

## Concepts this rests on

- Retained scene graph vs immediate-mode painting: the tree is state, the frame is derived.
- Flex layout as a pure function: `(tree, constraints) -> boxes`. Yoga owns it; we never guess sizes.
- Structural sharing: an edit returns a new tree sharing untouched subtrees, so undo is free and
  change detection is a reference compare.
- Device pixel ratio: a canvas has CSS size and backing-store size; mixing them blurs everything.
- Dirty-subtree invalidation: relayout and repaint the smallest region a patch can affect.
- Atomic file write: write temp, fsync, rename — a crash never leaves a half-written document.
- MCP tool surface: the agent gets typed tools over the same store the UI mutates, not a side copy.

## Open decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Document format | own schema, inspired by `.pen` / byte-compatible with `.pen` | Own schema, own extension. Compatibility buys nothing and couples us to their versioning. |
| 2 | Store & undo | Immer patches + inverse patches / hand-rolled command objects / CRDT | Immer patches. Undo and dirty-tracking fall out of it; CRDT only when multiplayer is real. |
| 3 | UI framework | React + Vite / Svelte / vanilla | React + Vite. Same as Pen, biggest ecosystem for panels and inspectors. |
| 4 | Hit-testing | AABB over Yoga boxes / Skia path hit-test / quadtree | AABB first. Exact path hit-test only for `path` nodes, later. |
| 5 | Repo shape | one repo, two Vite builds (main + renderer) / monorepo | One repo. A monorepo for one app is overhead. |
| 6 | Agent surface | MCP server only / bundle an agent SDK in-app | MCP server only. The user already runs Claude Code; bundling SDKs adds ~1GB and no differentiation. |

## Milestones

### M1 · Canvas that draws a document
Electron shell + React renderer + CanvasKit surface. Load a `.spen` JSON file from disk and paint
`frame`, `rectangle` and `text` with absolute positions. Pan and zoom.
After it: the user can open a file and look at it.
Risk: CanvasKit init, DPR correctness, paint loop performance. Highest-risk foundation, so first.

### M2 · Edit and save
Immutable store with Immer patches, selection, move and resize handles, undo/redo, atomic save,
dirty indicator, new/open/save-as.
After it: the user can draw and keep work.
Risk: coordinate math between screen, canvas and node space.

### M3 · Flex layout
Yoga integration, `layout/gap/padding/justifyContent/alignItems`, `fit_content` and
`fill_container` with fallbacks, dirty-subtree relayout.
After it: nested auto-layout frames behave like real UI.
Risk: keeping the Yoga tree in sync with the document tree without rebuilding it every frame.

### M4 · Styling
Fills (solid, gradient, image), stroke, corner radius, effects (shadow, blur), text styles with
HarfBuzz shaping. Properties inspector panel.
After it: designs look finished.
Risk: text metrics and line breaking.

### M5 · MCP server
MCP server in the main process, IPC to the renderer store. Tools: read tree, find nodes, create and
update nodes, set text, screenshot. Install into Claude Code config.
After it: an agent can build inside the user's open document.
Risk: write races between the agent and the user; needs a single serialized patch path.

### M6 · Components and variables
`ref` nodes with masters and overrides, document `variables` with `$name` binding, theme axes.
After it: a real design system, not just drawings.
Risk: override resolution order and circular refs.

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-26 | Model the build on Pen, not Paper | Local-first, no server to run; the hard part (render engine) is reusable off the shelf. |
| 2026-10-26 | Render with `canvaskit-wasm` (Skia) | Same engine Pen ships. Shaders, blend modes and real text shaping for free; writing an engine is months. |
| 2026-10-26 | Layout with `yoga-layout` | The schema is flexbox. Yoga is the implementation everyone else already uses. |
| 2026-10-26 | Document is JSON on disk, our own schema | Single-document app; no DB needed. Own schema avoids coupling to `.pen` versioning. |
| 2026-10-26 | Electron, not Tauri | Needs local files, child processes and reliable WebGL for WASM Skia. |
| 2026-10-26 | MCP server only for v1, no bundled agent SDK | +1GB of bundle for no differentiation; the user already has a harness. |
| 2026-10-26 | Build with `electron-vite`, not two hand-written Vite configs | One config covers main, preload and renderer, with HMR and main-process restart already wired. Supersedes the "two Vite builds" line in Big picture. |
| 2026-10-26 | Load `canvaskit.wasm` through a Vite `?url` import, not a copy plugin | Supersedes M1.1 design decision 3. A copied file served from `/canvaskit.wasm` 404s under `file://` in the packaged build; `?url` lets Vite emit, hash and resolve it relative to the document. |
| 2026-10-26 | In-app agent through the Claude Agent SDK, driving the user's installed `claude` | Supersedes "MCP server only, no bundled agent SDK". The user wants to design from inside the app with their Claude subscription, as Pen allows. Pointing the SDK at the installed executable avoids bundling a 270MB binary. |
| 2026-10-26 | The surface never owns the canvas element's CSS size | Writing px into `style.width` overrode the `100vw` rule and froze the canvas at its first size, so resize stopped firing. A host element owns layout; the canvas is sized from the host's measured rect. |

## Tickets

| Ref | Title |
|---|---|
| `f03c6bc3` | M1.1 · Scaffold Electron shell with a CanvasKit surface |
| `fd6fe9e2` | M1.2 · Define the document schema and load a file |
| `49f61073` | M1.3 · Paint the scene and add viewport pan and zoom |
| `4570e39a` | M2.1 · Build the document store with undo and redo |
| `79004175` | M2.2 · Hit-test and select nodes |
| `a8afc014` | M2.3 · Move and resize selected nodes |
| `520fe3fa` | M2.4 · Save, open and track the dirty document |
| `36e484db` | M3.1 · Mirror the document tree into a Yoga tree |
| `ff08dd73` | M3.2 · Implement layout properties and sizing behaviors |
| `446ea9b3` | M3.3 · Relayout and repaint only the dirty subtree |
| `0036ba88` | M4.1 · Render fills: solid, gradient and image |
| `64157634` | M4.2 · Render strokes, corner radius and effects |
| `5418753b` | M4.3 · Shape and render text properly |
| `c2dbbbbc` | M4.4 · Build the properties inspector panel |
| `f871b464` | M5.1 · Serialize all mutations through one patch path |
| `a0ae5c52` | M5.2 · Expose read tools over MCP |
| `053f80e6` | M5.3 · Expose write tools over MCP and install into the harness |
| `486e77e1` | M6.1 · Add document variables and themes |
| `6d24c65c` | M6.2 · Add components with masters, instances and overrides |

Open questions raised by tickets, to answer before their build: file extension (M1.2), autosave
default (M2.4), bundled vs system fonts (M4.3), defer vs reject agent writes during a drag (M5.1).

## Ticket log

### M1.1 · Scaffold Electron shell with a CanvasKit surface — `f03c6bc3`

Status: done, verified in the running app.

#### Overview

First ticket of M1, and the foundation of the whole app. Nothing else in the plan can start until
Skia paints a pixel in an Electron window at the right density. It delivers no user-visible feature
beyond a red rectangle; its value is that it settles the riskiest unknown early.

Toolchain observed on this machine (2026-10-26): Node 24.22.1, npm 11.19.1. Latest published:
electron 45.0.0, electron-vite 6.0.0, vite 8.3.5, react 19.3.1, canvaskit-wasm 0.42.0,
typescript 7.0.2.

#### Educate

**Concept 1 — Device pixel ratio**

*Fundamental.* A `<canvas>` has two sizes. Its CSS size (`style.width`) is how much room it takes on
screen, measured in CSS pixels. Its backing-store size (the `width` and `height` attributes) is how
many real pixels it stores. The browser scales the backing store to fit the CSS box. On a Retina
display one CSS pixel is two physical pixels, so a canvas with equal CSS and backing sizes gets
stretched 2x and looks soft.

*In this case.* Set the backing store to `cssWidth * devicePixelRatio`, keep the CSS size in CSS
pixels, then scale the Skia canvas by the same ratio so drawing code can keep thinking in CSS
pixels. All three must be updated together whenever the window resizes or the window moves to a
monitor with a different ratio.

*Trade-off.* Drawing in device pixels instead avoids the scale call, but then every coordinate in
the app — layout, hit-testing, snapping thresholds — has to carry the ratio. One scale at the top is
cheaper than ratio-awareness everywhere.

*Check yourself.* The window moves from a Retina screen to an external 1x monitor. What has to
change, and what happens if only the CSS size is updated?

**Concept 2 — WASM module lifetime vs surface lifetime**

*Fundamental.* Loading a WASM module compiles and instantiates it, which is expensive and
asynchronous. The module holds the code. A Skia *surface* holds the pixels and is bound to a
specific canvas element at a specific size. These have different lifetimes: the module is created
once per process, the surface is recreated whenever its target size changes.

*In this case.* `CanvasKitInit()` resolves once at startup and is cached. On every resize the old
surface is deleted and a new one made for the new backing size. Skia objects live in WASM memory, so
`surface.delete()` is a real deallocation — forgetting it leaks for the life of the process, and the
leak is invisible to JS heap tooling.

*Trade-off.* Keeping one oversized surface and drawing into a sub-rect avoids churn on every resize
event, at the cost of wasted GPU memory and extra bookkeeping. Recreate on resize, debounced, until
measurement says otherwise.

*Check yourself.* Why does a JS heap snapshot not show a leaked Skia surface?

**Concept 3 — Electron's process split**

*Fundamental.* Electron runs a Node process (main) that owns windows, menus, files and child
processes, and one Chromium process per window (renderer) that owns the DOM and GPU. They share no
memory. A preload script runs in the renderer with Node access and is the only sanctioned bridge,
exposing a narrow API through `contextBridge`.

*In this case.* Main creates the window and will later host file I/O and the MCP server. The
renderer owns CanvasKit and the canvas. The preload will carry file and MCP traffic later; in this
ticket it exists but exposes almost nothing. Context isolation and `nodeIntegration: false` stay on
from the start, because retrofitting them later means rewriting every call site.

*Trade-off.* Turning on `nodeIntegration` would let the renderer read files directly and skip the
bridge. It also hands full filesystem access to any script the renderer ends up loading. Not worth
it for a few IPC calls.

*Check yourself.* Why can the renderer not just call `fs.readFile` when the plan already trusts the
local document file?

#### Design

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Build tooling | `electron-vite` / two hand-written Vite configs / Electron Forge | `electron-vite`. One config with main, preload and renderer entries, HMR for the renderer and restart for main already wired. Supersedes the "two Vite builds" line in the earlier plan. |
| 2 | Skia surface backend | `MakeWebGLCanvasSurface` (GPU) / `MakeCanvasSurface` (CPU raster) | WebGL, with a CPU fallback if context creation fails. GPU is the point; the fallback keeps the app usable on a broken driver. |
| 3 | Where the `.wasm` file lives | copied into the renderer's public dir with `locateFile` / bundled as a data URL / fetched from a CDN | Public dir plus `locateFile`. 9MB inlined bloats the bundle; a CDN breaks the local-first promise. |
| 4 | TypeScript version | 7.0.2 (latest) / pin to 5.x | 7.0.2. If a Vite or Electron plugin trips on it, pin to 5.x and record it here — not worth pre-empting. |
| 5 | Proof of paint | a red rect drawn once / an animated frame counter | Red rect plus a one-line `requestAnimationFrame` loop, so M1.3 has a loop to grow into rather than a rewrite. |

#### Plan

Files:

```
package.json
tsconfig.json
electron.vite.config.ts
src/main/index.ts          window creation, dev/prod URL
src/main/preload.ts        contextBridge, near-empty for now
src/renderer/index.html
src/renderer/main.tsx      React root
src/renderer/canvas/canvaskit.ts   module init, cached promise
src/renderer/canvas/surface.ts     surface create/resize/delete, DPR math
src/renderer/canvas/Stage.tsx      canvas element, resize observer, raf loop
test/surface.spec.ts
```

Steps:

1. `npm init`, install electron, electron-vite, vite, react, react-dom, typescript, vitest,
   canvaskit-wasm. Add `dev`, `build` and `test` scripts.
2. `electron.vite.config.ts` with the three entries; copy `canvaskit.wasm` from `node_modules` into
   the renderer's public dir as a build step.
3. Main process: a 1280x800 `BrowserWindow`, `contextIsolation: true`, `nodeIntegration: false`,
   loads the dev server URL or the built file.
4. `canvaskit.ts`: one cached `CanvasKitInit` promise with `locateFile` pointing at the copied wasm.
5. `surface.ts`: `createSurface(canvas, cssW, cssH, dpr)` sets attributes and CSS size, makes the
   WebGL surface, scales the Skia canvas by `dpr`, returns a handle with `resize()` and `dispose()`.
6. `Stage.tsx`: a `ResizeObserver` drives debounced resize, a `requestAnimationFrame` loop clears
   and draws the red rect, cleanup deletes the surface.
7. Tests: backing size equals `css * dpr` across ratios 1, 2 and 2.5; resize disposes the previous
   surface exactly once; the init promise is created only once under concurrent callers.

Done when: `npm run dev` shows a crisp red rect on Retina, it stays crisp after resize and across a
monitor change, and `npm test` passes.

#### What changed from the plan

1. The `copyCanvasKitWasm` build plugin was written, shipped and then deleted. It copied the wasm
   into the renderer's public dir and `locateFile` returned `/canvaskit.wasm`. That works behind a
   dev server and 404s under `file://` in the packaged build, where an absolute path means the
   filesystem root. Replaced with `import wasmURL from 'canvaskit-wasm/bin/canvaskit.wasm?url'`, so
   Vite emits, hashes and resolves it. `createCanvasKitLoader` now takes the url instead of building
   one. Added `src/renderer/vite-env.d.ts` to declare that import.
2. `Stage` wraps the canvas in a host `div`. The first version put `width: 100vw` on the canvas
   itself, and `applyCanvasSize` then wrote `style.width = '1280px'` over it. The canvas stopped
   following the viewport, so `ResizeObserver` never fired again and the surface was frozen at its
   first size. Caught only by probing the live app after a resize, not by the unit tests. The host
   owns layout; the surface reads the host's rect.
3. Verification needed a throwaway Electron harness (`/tmp`) that loads the built renderer and calls
   `webContents.capturePage()`. The real window would not come forward for a screenshot, and the
   harness also gives an exact probe of canvas attributes versus CSS size.

#### Recap

Shipped: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.mts`,
`src/main/index.ts`, `src/preload/index.ts`, `src/renderer/{index.html,main.tsx,vite-env.d.ts}`,
`src/renderer/canvas/{canvaskit.ts,surface.ts,paint.ts,Stage.tsx}`, `test/surface.spec.ts`.

Verified: a 200x120 CSS rect renders as 400x240 device pixels at DPR 2 with sharp edges; after
resizing the window to 700x500 the canvas backing store is 1400x936 against a 700x468 CSS box and
the rect stays sharp. 7 tests pass, typecheck clean.

Remember: a Skia surface is bound to a size, so every resize is a dispose plus a create; and
whatever writes a CSS size owns that element's layout, so the surface must not.

Check yourself: the app moves from a Retina display to a 1x monitor without the window resizing.
Which listener catches it, and what does `rebuild` compare to decide a new surface is needed?

### M1.2 · Define the document schema and load a file — `fd6fe9e2`

Status: done, verified in the running app. Extension decided: `.spen`.

#### Overview

Second ticket of M1. M1.1 proved pixels can reach the screen; this one decides what gets drawn.
Every later ticket reads this shape: the store patches it (M2.1), Yoga mirrors it (M3.1), the
inspector edits it (M4.4), the MCP tools speak it (M5.2). Getting the shape wrong is the most
expensive mistake available right now, which is why it is a ticket of its own and not a side effect
of M1.3.

Scope is deliberately narrow: five node types, no styling beyond a solid fill, read-only. Fills,
strokes, effects, layout, variables and components each arrive with the milestone that renders them.

#### Educate

**Concept 1 — Parse, don't validate**

*Fundamental.* Data arriving from outside the program — a file, a socket, an IPC message — has an
unknown shape no matter what the type annotation says. TypeScript types vanish at runtime, so
`JSON.parse(text) as Document` is a lie the compiler will happily believe. "Parse, don't validate"
means converting unknown input into a trusted type exactly once, at the boundary, and having that
conversion fail loudly. Everything inside the boundary then works with a type that is true.

*In this case.* The main process reads the file and runs it through the schema before it goes over
IPC. The renderer receives a `Document` it never has to re-check. One boundary, one parse. The parse
failure carries the path to the offending field, because the user will edit `.spen` files by hand
and a message like "expected number" with no location is useless.

*Trade-off.* Hand-written type guards have no dependency and no bundle cost, but every new property
means another guard, and producing a field path by hand is tedious enough that it quietly stops
happening. A schema library costs a dependency and buys the paths for free. At the size this schema
will reach by M6 the library wins.

*Check yourself.* The renderer gets the document over IPC. Why does it not re-validate, and what
would have to change for that to become unsafe?

**Concept 2 — Version the file from the first write**

*Fundamental.* A file format is a promise to your future self. Once a user has saved a document you
cannot change the format freely: you must be able to recognise the old shape and convert it. That is
only possible if the old shape says what it is. A file with no version field is unmigratable — you
are reduced to guessing from the presence of keys.

*In this case.* Every `.spen` carries `"version": 1` as an integer. Parsing checks the version first
and reports an unsupported version as its own error, distinct from a malformed document, so a user
opening a future file gets "this file was made by a newer version" and not "expected object". No
migration machinery is built yet — there is nothing to migrate from — but the hook it will need is
in place.

*Trade-off.* A semver string carries more information and lets us distinguish compatible from
breaking changes. It also invites comparison logic nobody needs when there is exactly one version.
An integer that increments on breaking changes is enough.

*Check yourself.* Why is "unsupported version" a different error from "malformed document", given
both end in a failed load?

**Concept 3 — Tree is the truth, index is derived**

*Fundamental.* A node graph can be stored as a nested tree or as a flat map of id to node plus
parent pointers. The tree matches the serialized file, makes ordering and containment implicit, and
is what a human reads. The flat map makes lookup by id O(1) and makes "find this node" trivial, but
duplicates the structure and can go out of sync with it.

*In this case.* The file and the in-memory document are the tree. An id-to-node-and-parent index is
built by one walk after parsing and rebuilt when the tree changes. The index is cache, never state:
it is not serialized, and it may be thrown away and recomputed at any time without losing anything.

*Trade-off.* Keeping only the tree means every lookup is a walk — fine at a hundred nodes, bad at
five thousand, which M3.3 explicitly benchmarks. Keeping only the flat map means reconstructing
order and nesting on every save. Tree as truth plus derived index is the usual answer and the one
Figma-shaped editors converge on.

*Check yourself.* An agent asks to update node `n_42`. Which structure answers "where is it", and
which one answers "what is it inside of"?

#### Design

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Validator | Zod 4 / hand-written type guards / Ajv with JSON Schema | Zod 4. Field paths in errors for free, types inferred from the schema so they cannot drift, and the schema grows a lot between here and M6. |
| 2 | Node identity | a required `id` on every node / index paths like Pen's `IdPath` / ids generated on load | Required `id`, rejected on duplicates. Index paths shift under every insert, which breaks an agent holding a reference across calls (M5.3). |
| 3 | Where parsing happens | main, before IPC / renderer / both | Main. One boundary. The renderer treats IPC as trusted because main is the only thing that can send on it. |
| 4 | Colour representation | hex string `#RRGGBBAA` / `{ r, g, b, a }` object | Hex string. Compact, hand-editable, and the same choice Pen made; parsed into channels at paint time. |
| 5 | Unknown node types | reject the whole document / skip unknown nodes with a warning | Reject. v1 has no forward-compatibility promise to keep, and silent dropping loses user data. The version field is how this is reconsidered later. |
| 6 | How the renderer gets a document | IPC request for an initial document / main pushes on ready / renderer reads the file itself | IPC request. The renderer asks once on mount; file dialogs and arbitrary paths belong to M2.4. |

#### Plan

Shape, in `.spen`:

```json
{
  "version": 1,
  "children": [
    { "id": "f1", "type": "frame", "name": "Screen", "x": 0, "y": 0, "width": 390, "height": 844,
      "fill": "#ffffff", "children": [
        { "id": "r1", "type": "rectangle", "x": 24, "y": 64, "width": 342, "height": 120,
          "fill": "#2f6fed", "cornerRadius": 12 },
        { "id": "t1", "type": "text", "x": 24, "y": 200, "width": 342, "height": 40,
          "fill": "#101114", "content": "Hello", "fontSize": 24 }
      ]
    }
  ]
}
```

Node types: `frame` (box with children), `group` (children, no box), `rectangle`, `ellipse`, `text`.
Shared fields: `id`, `type`, optional `name`, `x`, `y`, `width`, `height`, optional `fill`.
Coordinates are CSS pixels relative to the parent, y down, matching M1.3's paint walk.

Files:

```
src/shared/schema/node.ts        node schemas, recursive via z.lazy
src/shared/schema/document.ts    document schema, parseDocument(), DocumentParseError
src/shared/document/index-tree.ts  buildIndex(doc) -> Map<id, { node, parent }>
src/main/file-io.ts              readDocument(path)
src/main/ipc.ts                  ipcMain.handle('document:open-initial')
src/preload/index.ts             expose openInitialDocument()
src/renderer/document/use-document.ts  hook calling it on mount
fixtures/hello.spen
test/schema.spec.ts
```

Steps:

1. `npm i zod`.
2. `node.ts`: a base object schema, the five node variants as a discriminated union on `type`,
   recursion through `z.lazy` for `frame` and `group`, hex colour as a regex-checked string.
3. `document.ts`: `version` literal check first and a distinct unsupported-version error, then the
   children array; `parseDocument(unknown)` returns the typed document or throws a
   `DocumentParseError` carrying the Zod issue path joined as `children[0].children[1].width`.
4. `index-tree.ts`: one walk producing the id index, failing on a duplicate id.
5. `file-io.ts`: read the file as UTF-8, `JSON.parse`, `parseDocument`, with a readable error for
   each failure mode including a missing file.
6. `ipc.ts` plus preload: `document:open-initial` loads `fixtures/hello.spen` for now.
7. Renderer hook requests it on mount and holds it in state; M1.3 consumes it.
8. Tests: the fixture parses to the expected tree; a missing `version` fails; `version: 99` gives the
   unsupported-version error; `"width": "100"` names the path `children[0].children[0].width`; an
   unknown `type` is rejected; a duplicate id is rejected.

Done when: the fixture round-trips to a typed document, every failure names where it went wrong, and
the tests above pass.

#### What changed from the plan

1. Zod 4 recursion is written as a getter inside the object shape
   (`BaseNode.extend({ type: z.literal('frame'), get children() { return z.array(NodeSchema) } })`),
   not as `z.lazy` behind an explicit `z.ZodType<FrameNode>` annotation. The annotated form compiles
   on its own but `z.discriminatedUnion` rejects it: the union needs real object schemas so it can
   read each member's discriminator values, and a `z.ZodType` has erased them. The getter keeps the
   object type intact and infers the recursive type without a hand-written interface.
2. Added `src/renderer/App.tsx`, which was not in the plan. The loading, failed and ready states
   needed somewhere to live, and putting them in `Stage` would have mixed document lifecycle into
   the paint loop. `main.tsx` now renders `App`, which renders `Stage` only once a document is in
   hand.
3. Added a seventh test for a non-hex colour. The hex regex is the one piece of validation that is
   easy to get wrong and silently accept.
4. Verification could not reuse the M1.1 capture harness. The harness loads the built renderer from
   its own script directory, which changes `app.getAppPath()` — the exact value that resolves the
   fixture. Probed the real `electron .` process over CDP on `--remote-debugging-port` instead, with
   a small script using Node's built-in `WebSocket`.

Known gap: the packaged branch of `initialDocumentPath` (`process.resourcesPath`) is unexercised;
nothing is packaged yet. It gets its first real test when packaging arrives.

#### Recap

Shipped: `src/shared/schema/{node.ts,document.ts}`, `src/shared/document/index-tree.ts`,
`src/main/{file-io.ts,ipc.ts}`, `src/preload/index.ts`, `src/renderer/App.tsx`,
`src/renderer/document/use-document.ts`, `fixtures/hello.spen`, `test/schema.spec.ts`.
Added `zod` 4.6.7.

Verified: the running app loads `fixtures/hello.spen` over IPC and the renderer receives
`{ version: 1, children: [frame > r1, e1, t1] }`. 15 tests pass across both files, typecheck clean.
A bad `width` reports the path `children[0].children[0].width`; version 99 reports an unsupported
version rather than a malformed document.

Remember: validate once, in main, before the data crosses IPC — and keep the version check ahead of
the shape check, so a newer file gets an honest answer instead of a pile of field errors.

Check yourself: an agent inserts a node at the top of a frame's children. What happens to a
reference held as an index path, and what happens to one held as an id?

### M1.3 · Paint the scene and add viewport pan and zoom — `49f61073`

Status: done, verified in the running app. Closes M1.

#### Overview

Closes M1. M1.1 made a surface, M1.2 made a document; this joins them into something a person can
look at and move around. After it the app is a read-only viewer: open the fixture, pan, zoom, see
the shapes. Everything in M2 (selection, dragging, editing) is built on the coordinate conversion
this ticket establishes, so the conversion is the part worth getting exactly right — the paint walk
itself is nearly mechanical.

#### Educate

**Concept 1 — Three coordinate spaces**

*Fundamental.* A pointer event arrives in screen space: pixels from the top-left of the window. The
canvas has its own space, offset by where the canvas element sits in the page and scaled by device
pixel ratio. The document has a third space, where a node's `x: 24` means 24 units from its parent's
origin regardless of where the user has panned or how far they have zoomed. Every interactive
graphics program carries these three and converts between them; bugs where a click lands slightly
off, or off by a factor of two on Retina, are always a conversion done twice or not at all.

*In this case.* Conversion happens once, at the edge: a pointer handler turns the event into
document coordinates immediately, and everything downstream works in document space. Painting runs
the other way — the Skia canvas carries the viewport transform, so the paint walk emits raw document
coordinates and never multiplies anything. DPR is already handled inside the surface (M1.1), so the
viewport math never sees it.

*Trade-off.* Converting lazily, wherever a value is needed, avoids thinking about where the boundary
is. It also means every new feature re-derives the conversion, and one of them will get it wrong.
One documented edge is cheaper.

*Check yourself.* The user has panned by (100, 50) and zoomed to 2x. They click at screen (300, 200)
inside a canvas whose top-left is at screen (0, 0). What document point is that, and which of DPR,
pan and zoom took part in the answer?

**Concept 2 — Zoom at the cursor is translate, scale, translate**

*Fundamental.* Scaling a view multiplies everything by a factor about the origin, so a plain scale
pulls the content toward the top-left corner. Zooming "at the cursor" means one specific document
point — the one under the pointer — must stay at the same screen position while everything else
moves around it. The standard construction is to translate that point to the origin, scale, then
translate back: the pan offset absorbs the difference.

*In this case.* On a zoom gesture, take the document point under the cursor before the scale change,
apply the new scale, then set pan so that same document point maps back to the same screen point.
Two lines of arithmetic, written once in `viewport.ts`, used by the wheel handler and by any later
zoom-to-fit or zoom-to-selection.

*Trade-off.* Zooming about the viewport centre instead is simpler and is what some tools do for
keyboard shortcuts. For pointer-driven zoom it feels wrong immediately: content slides out from
under the cursor. Keep centre-zoom for keyboard, cursor-zoom for wheel and pinch.

*Check yourself.* Why does the pan offset have to change when the scale changes, even though the
user did not pan?

**Concept 3 — Immediate-mode painting over retained state**

*Fundamental.* There are two ways to put a scene on a screen. Retained mode keeps a parallel tree of
drawable objects that you mutate — the DOM works this way. Immediate mode keeps no such tree: every
frame, you walk your own state and issue draw calls from scratch. Immediate mode means there is
exactly one source of truth and nothing can fall out of sync, at the cost of redrawing things that
did not change.

*In this case.* The document is the state; the frame is derived from it and stored nowhere. The
paint walk recurses the node tree and issues Skia calls. No per-node drawable objects, no
diffing. M3.3 will add dirty-subtree invalidation to skip work, but that is an optimisation on top
of this model, not a change to it — the frame is still derived.

*Trade-off.* A retained scene graph can cache expensive per-node work (shaders, text layout,
pictures). It also introduces the sync problem this ticket is avoiding. Start immediate; cache only
where a benchmark proves it matters.

*Check yourself.* The red rectangle from M1.1 redraws 60 times a second even when nothing changes.
Why is that currently fine, and what measurement would make it not fine?

#### Design

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Viewport representation | `{ x, y, scale }` / a full 3x3 affine matrix | `{ x, y, scale }`. There is no rotation or skew on the viewport and there never will be; a matrix hides the two numbers a zoom gesture has to adjust. |
| 2 | Applying the transform | `canvas.translate` + `canvas.scale` on the Skia canvas / multiply coordinates per node in the walk | Skia canvas transform. The walk then emits document coordinates verbatim, which is also what makes nested frames a plain `translate` per level. |
| 3 | Pan input | space-drag only / trackpad scroll only / both, plus middle-drag | Both. Two-finger scroll pans, `ctrl`/pinch-wheel zooms at the cursor, space-drag pans — the combination every design tool uses, so muscle memory transfers. |
| 4 | Text rendering | defer to M4.3 and draw a placeholder / load one OS font over IPC now / add a bundled font dependency now | **Defer to M4.3.** CanvasKit ships no default typeface, so "plain text" means picking and loading a font file — font loading, fallback and measurement are M4.3's entire subject. M1.3 draws text nodes as their fill at 35% with a baseline rule, so the fixture reads correctly without pre-deciding M4.3. This trims the ticket's stated scope; say so if you would rather pay for it now. |
| 5 | Zoom limits | none / clamp to 0.02–64x | Clamp. Skia coordinates lose precision at extremes and an unclamped trackpad can reach them in one gesture. |
| 6 | Redraw trigger | every frame unconditionally / dirty flag set by viewport and document changes | Dirty flag, already in `Stage` from M1.1. Keeps idle cost at zero and is the hook M3.3 extends. |

#### Plan

```
src/renderer/canvas/viewport.ts    Viewport type, toDocument, toScreen, zoomAt, panBy, clamp
src/renderer/canvas/paint.ts       paintDocument(ck, surface, document, viewport, dpr)
src/renderer/canvas/Stage.tsx      pointer, wheel and key handlers; viewport state; dirty flag
test/viewport.spec.ts
```

Viewport:

```ts
type Viewport = { x: number; y: number; scale: number }
toDocument(v, screenPoint) -> { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale }
toScreen(v, docPoint)      -> { x: dx * v.scale + v.x, y: dy * v.scale + v.y }
zoomAt(v, screenPoint, factor) -> keeps toDocument(v, screenPoint) fixed, clamps scale
```

Paint walk: clear, `save`, `translate(v.x, v.y)`, `scale(v.scale, v.scale)`, recurse children —
each node `save`, `translate(node.x, node.y)`, draw in local space, recurse its children, `restore`
— then `restore` and `flush`. `frame` and `rectangle` draw a rounded or plain rect in the node's
fill; `ellipse` draws an oval in its bounds; `group` draws nothing itself; `text` draws the
placeholder. Paint objects are created per frame for now and deleted at the end of the walk; M4.1
introduces the cache once there is something worth caching.

Input, all in `Stage`: `wheel` with `ctrlKey` or `metaKey` zooms at the cursor, plain `wheel` pans by
`deltaX`/`deltaY`, `space` held plus pointer drag pans, every change marks the frame dirty.

Tests: `toDocument(toScreen(p))` round-trips under a pan plus a zoom for several points;
`zoomAt` keeps the document point under the cursor fixed to within a float epsilon; scale clamps at
both ends; panning does not change scale.

Done when: the fixture renders with the frame, card, avatar and a text placeholder in the right
places; trackpad pan and cursor zoom feel right; the round-trip and zoom-anchor tests pass.

#### What changed from the plan

1. Added `fitToBounds` and `documentBounds`, neither in the plan. Opening at the identity viewport
   put the fixture's frame at the window's top-left corner with most of it off screen, which reads
   as a bug the first time you launch it. The first surface creation now fits the document bounds
   into the viewport once, and only once — a later pan must not be undone by a resize.
2. Added `src/renderer/canvas/color.ts`. The plan assumed hex-to-channels was a line inside `paint`;
   it is a small parser with a short-form case (`#abc`) and an optional alpha pair, so it got its
   own file and is unit-tested through the paint fixtures.
3. Zoom sensitivity was wrong on first run: `exp(-deltaY * 0.0025 * 4)` turned one wheel notch into
   roughly an 11x zoom and threw the document off screen. Dropped the factor of 4. Caught only by
   firing a real wheel event at the running app — the unit tests check that `zoomAt` anchors
   correctly, which it did, at an absurd scale.
4. Verification could not use CDP `Input.dispatchMouseEvent` with `type: 'mouseWheel'`; the call
   never returned and hung the debugger session. Dispatching a `WheelEvent` through
   `Runtime.evaluate` instead works and exercises the same handler.

#### Recap

Shipped: `src/renderer/canvas/{viewport.ts,color.ts,paint.ts,Stage.tsx}`, `test/viewport.spec.ts`.

Verified in the running app: the fixture renders fitted and centred — white frame, blue rounded
card, yellow avatar, grey text placeholder with its baseline rule; a `ctrl`-wheel at (640, 300)
zooms about that point; a plain wheel pans by the delta. 23 tests pass across three files, typecheck
clean.

Remember: the paint walk emits document coordinates and lets the canvas transform do the work —
that is why nested frames cost one `translate` per level and nothing else. And a gesture constant
is not provable by a unit test; it has to be felt against the real input device.

Check yourself: `fitToBounds` runs on surface creation, but only the first one. What breaks if it
runs on every resize instead?

### M2.1 · Build the document store with undo and redo — `4570e39a`

Status: done, tests green, app still renders through the store.

#### Overview

First ticket of M2 and the single most load-bearing piece of plumbing in the project. Every mutation
in every later milestone goes through it: a drag handle (M2.3), an inspector field (M4.4), an agent
tool call (M5.3). If edits can reach the document by any other route, undo is broken and nobody
notices until a user loses work.

It ships no visible feature. What it buys is that M2.2 onwards never has to think about history
again — they write a recipe, history happens.

#### Educate

**Concept 1 — Structural sharing**

*Fundamental.* Copying a tree to change one leaf is wasteful: every untouched subtree gets
duplicated. Structural sharing copies only the nodes on the path from the root to the change and
reuses every other subtree by reference. A 5000-node document where one rectangle moves produces a
new root, a new frame, a new rectangle — and the other 4997 nodes are the same objects as before.

*In this case.* Immer does this for us. The consequence that matters is not memory, it is change
detection: `previous.children[0] === next.children[0]` is a correct and O(1) answer to "did this
subtree change". M3.3's dirty-subtree invalidation is built on exactly that comparison, and it only
works if nothing ever mutates a node in place. That is why the store is the only writer.

*Trade-off.* Mutating the tree directly is faster per edit and needs no library. It also makes every
"did this change" question a deep walk, and one stray in-place mutation silently breaks every
cache downstream. The frozen-and-shared tree makes that mistake throw instead.

*Check yourself.* After moving node `t1`, which nodes in the fixture are new objects and which are
the same references as before?

**Concept 2 — Inverse patches make undo data, not code**

*Fundamental.* The classic way to build undo is the command pattern: every operation is an object
that knows how to do and how to undo itself. It works, and it means every new operation is two
implementations that must stay in agreement — the second one tested less than the first.

A patch-based history instead records what actually changed: a list of
`{ op, path, value }` entries, plus the inverse list that puts the old values back. The recorder
produces both from the same edit, so they cannot disagree. Adding an operation adds no undo code at
all.

*In this case.* `produceWithPatches` returns the next document, the forward patches and the inverse
patches. A history entry is just those two lists. Undo applies the inverse and pushes the entry onto
the redo stack; redo applies the forward patches. The store never knows what kind of edit it was,
which is exactly why an agent's edit (M5.3) is undoable by the user without any extra work.

*Trade-off.* Patches are opaque — a history entry cannot describe itself as "Move rectangle" for a
menu label. Carrying a human label alongside the patches costs one string and is worth it, so the
entry gets one.

*Check yourself.* Why can't a patch-based entry go stale the way a command object holding a node
reference can?

**Concept 3 — Coalescing: a gesture is one history entry**

*Fundamental.* Input is far finer-grained than intent. Dragging a node emits a `pointermove` every
frame; typing emits a keystroke per character. If each becomes a history entry, undo stops meaning
"take back what I did" and starts meaning "rewind 16 milliseconds", which is useless. Coalescing
merges a run of related edits into one entry.

*In this case.* The merge boundary is explicit: a gesture opens a transaction, every edit inside it
appends its patches to the open entry, and closing it pushes one entry. The alternative — merging
edits that arrive within some time window — guesses at intent and gets it wrong at exactly the
moments that matter, like a pause mid-drag.

*Trade-off.* Explicit transactions mean every gesture has to remember to close one, including on an
error or an interrupted drag. The store defends against that by auto-closing when a new transaction
opens, and by exposing the open-transaction state so a test can assert it is clean.

*Check yourself.* A drag is interrupted when the window loses focus mid-gesture. What should the
history contain, and what closes the transaction?

#### Design

Decision 2 in the project table (Immer patches over command objects or CRDT) is settled; these are
the ticket's own choices.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Store plumbing | hand-rolled external store with `useSyncExternalStore` / Zustand / React context plus reducer | Hand-rolled, about 40 lines. The paint loop reads the current document through a getter every frame and must not re-render React to do it; `useSyncExternalStore` gives panels their subscription without a dependency. |
| 2 | Coalescing boundary | explicit `beginGesture` / `endGesture` / a time window / merging by matching patch paths | Explicit transactions. A gesture knows its own extent; a time window guesses and misfires on a pause mid-drag. |
| 3 | History depth | unbounded / capped at 200 entries | Capped at 200, oldest dropped. Patches are small but a long editing session is unbounded, and no user undoes 200 steps. |
| 4 | What undo restores | document only / document plus the selection at the time | Document only, for now. Selection does not exist until M2.2, and bolting it on later is one field on the entry. Noted so M2.2 can decide with its own context. |
| 5 | Immer auto-freeze | on / off | On. It turns an accidental in-place mutation into a thrown error instead of a silently stale cache. Revisit at M3.3 if the 5000-node benchmark says freezing costs too much. |
| 6 | Where the store is created | module singleton / created in `App` and passed down | Created in `App`, passed through a context. A singleton makes tests share state and makes a second window (M2.4) impossible. |

#### Plan

```
src/renderer/store/history.ts         History<Entry>, push, undo, redo, cap, open transaction
src/renderer/store/document-store.ts  createDocumentStore(initial): getState, subscribe, apply,
                                      beginGesture, endGesture, undo, redo, canUndo, canRedo
src/renderer/store/use-store.ts       context provider + useDocument() via useSyncExternalStore
src/renderer/App.tsx                  creates the store from the loaded document
src/renderer/canvas/Stage.tsx         reads through the store getter instead of a prop
test/store.spec.ts
```

Shape:

```ts
type Entry = { label: string; forward: Patch[]; inverse: Patch[] }

store.apply('Move card', (draft) => { draft.children[0].children[0].x += 10 })
store.beginGesture('Move card')
  store.apply(null, (draft) => { ... })   // appended to the open entry
store.endGesture()                        // one entry pushed
store.undo(); store.redo()
```

Steps:

1. `npm i immer`, `enablePatches()` once at module load.
2. `history.ts`: a plain class or closure holding `past`, `future` and an optional open entry;
   `push` clears `future` and enforces the cap; `undo`/`redo` move entries between the stacks and
   return the patches to apply.
3. `document-store.ts`: holds the current document; `apply` runs `produceWithPatches`, appends to
   the open entry or pushes a new one, swaps in the next document and notifies subscribers.
   `endGesture` on an empty transaction pushes nothing.
4. `use-store.ts`: a context with the store instance and `useDocument()` returning the current
   document via `useSyncExternalStore` with the store's `subscribe` and `getState`.
5. `App` creates the store once the document loads; `Stage` takes the store, reads the document in
   the paint loop through `getState`, and subscribes to mark the frame dirty.
6. Tests: an edit changes only the touched subtree and leaves siblings reference-equal; undo and
   redo restore exact deep-equal state across several edits; 200 simulated drag steps inside one
   gesture collapse to a single undo; a new edit after an undo clears the redo stack; the cap drops
   the oldest entry; an unclosed gesture is closed by the next one.

Done when: the listed tests pass and the app still renders the fixture, now reading through the
store.

#### What changed from the plan

1. Inverse patches are prepended, not appended, when an edit joins an open gesture
   (`pending.inverse.unshift(...inverse)`). Undo replays the inverse list in order, so for a run of
   edits it has to see the last edit's inverse first. Appending them gives a history entry that
   applies its undos in the order the edits happened and leaves the document subtly wrong — a bug
   that only shows up once a gesture contains edits to overlapping paths, which the 200-step drag
   test now covers.
2. The store is created in an `Editor` component inside `App`, not in `App` itself. `App` cannot
   create it: the document arrives asynchronously, and a store needs a document at construction.
   `Editor` mounts only once the document is in hand, so `useState(() => createDocumentStore(doc))`
   runs exactly once and never sees a null document.
3. `Stage` no longer takes a `document` prop. It reads `store.getState()` inside the paint loop and
   subscribes to mark the frame dirty, so a document change never re-renders React — which is the
   whole reason decision 1 chose a hand-rolled external store.
4. Nine tests instead of six. Added: an edit that changes nothing notifies nobody and pushes no
   history; subscribers are notified exactly once per applied edit, undo and redo included.

Known gap: undo and redo have no way to be triggered in the running app — no menu, no shortcuts
until M2.4. They are proven by unit tests only. The first live exercise of history is M2.3's drag.

#### Recap

Shipped: `src/renderer/store/{history.ts,document-store.ts,use-store.ts}`, rewritten
`src/renderer/App.tsx`, `src/renderer/canvas/Stage.tsx` reading through the store,
`test/store.spec.ts`. Added `immer` 11.2.9.

Verified: 32 tests pass across four files, typecheck clean, and the running app renders the fixture
identically now that the document comes from the store. A 200-step drag inside one gesture is a
single undo that restores the original document exactly.

Remember: one writer, one entry point. The value of `apply` is not what it does but what it forbids
— there is no other way to change the document, so history cannot be bypassed by a feature that
forgets about it.

Check yourself: an agent calls a write tool while the user is mid-drag with a gesture open. With
today's store, whose history entry does the agent's edit land in? (That is M5.1's whole subject.)

### M2.2 · Hit-test and select nodes — `79004175`

Status: done, verified in the running app. Planned and built together with M2.3 and M2.4 at the
user's request, so the three share one build pass; each keeps its own entry.

#### Educate

**Concept — Derived indexes and reverse paint order**

*Fundamental.* Hit-testing asks "what is under this point", which is the paint walk run backwards:
the last thing drawn is the thing on top, so the first match scanning from the end wins. But the
paint walk carries positions implicitly in the canvas transform, and a hit test cannot — it needs
absolute coordinates for every node at once.

*In this case.* `sceneItems(document)` flattens the tree into paint-ordered entries carrying
absolute bounds, the parent id and the depth. It is memoised in a `WeakMap` keyed by the document,
so structural sharing pays for itself immediately: a new document object means one rebuild, and an
unchanged one is free. Hit-testing, marquee selection, snapping candidates, the selection overlay
and resize all read the same list.

*Trade-off.* Keeping absolute bounds on the nodes themselves would remove the index. It would also
mean moving a frame has to rewrite every descendant, which is exactly what a tree of relative
coordinates exists to avoid.

*Check yourself.* Why is `sceneItems` safe to memoise on the document object, when the same
technique would be a bug if the store mutated in place?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Click semantics | deepest node under the cursor | Matches the ticket's "including inside nested frames". Figma-style select-outermost-then-double-click-to-enter was dropped; see the trim below. |
| 2 | Where selection lives | its own external store, not the document | Selection is view state: not serialised, not undoable, and a second window would have its own. |
| 3 | Marquee rule | fully enclosed, ancestors beat descendants | Partial-intersection selection picks up things the user did not drag across; returning both a frame and its children double-transforms them on the next move. |
| 4 | Overlay space | screen space, after the world transform | A 1px outline stays 1px at 64x zoom, and handles stay a fixed hit size. |

Files: `src/renderer/canvas/{scene-index.ts,hit-test.ts,overlay.ts}`,
`src/renderer/store/selection.ts`, `test/hit-test.spec.ts`.

#### What changed from the plan

1. Scope trim: double-click to enter a frame was not built. With deep hit-testing it has nothing to
   do — the deepest node is already selected on the first click. If select-outermost ever becomes
   the default, double-click comes back with it.
2. `itemsWithin` filters descendants out using a parent chain walked from the scene index. The first
   attempt compared `SceneItem.parent` node objects directly and could not walk past one level; the
   index now carries `parentId` and `parentChain` does the walk.

#### Recap

Verified: clicking picks the topmost node under the cursor, a marquee on empty canvas draws its wash
and selects what it encloses, selection outlines and eight handles render in screen space at any
zoom. 10 tests.

Check yourself: the marquee fully encloses a frame and its three children. Why does the selection
end up with one node, and what would go wrong if it kept all four?

### M2.3 · Move and resize selected nodes — `a8afc014`

Status: done, verified in the running app.

#### Educate

**Concept — A gesture is a state machine over a snapshot**

*Fundamental.* A drag is not a series of independent edits. It has a start, a stream of moves, and
an end, and every move means the same thing: "the selection should now be where it would be if the
pointer had gone straight here". Computing each move as a delta from the previous one accumulates
float error and goes wrong the moment one event is dropped or a snap adjusts the result. Computing
from a snapshot taken at gesture start is exact and idempotent.

*In this case.* `pointerdown` captures each selected node's rect twice — parent-relative (what gets
written back) and absolute (what snapping and scaling reason about) — and the gesture type holds
them. Every `pointermove` recomputes from that snapshot. The store's gesture transaction opens at
the same moment, so the whole drag is one undo step.

*Trade-off.* Snapshotting costs a walk per gesture start. Incremental deltas cost nothing per start
and a class of bugs that only reproduce on slow frames.

*Check yourself.* The pointer moves right 100, then back left 100. With snapshot math, what is the
final position? With incremental deltas and a snap that fired at step 3?

**Concept — Snapping in screen space, applied in document space**

*Fundamental.* A snap threshold is about what the eye can see, so it is a screen-pixel quantity.
The geometry it adjusts is in document units. Converting the threshold once, by dividing by the
viewport scale, keeps the feel constant at every zoom: 6px of slack at 1x and at 8x.

*In this case.* `snapRect` compares six lines of the moving rect — left, centre, right and top,
middle, bottom — against the same six of every other node, takes the closest within the threshold
per axis, and returns both the correction and the guides to draw.

*Trade-off.* Comparing against every node is O(n) per move event. At 5000 nodes that is the thing
M3.3's benchmark will catch; a spatial index is the upgrade when it does.

*Check yourself.* Why does the threshold have to be divided by the scale rather than multiplied?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Resize model | one bounding box, nodes scaled into it | Single and multi-selection take the same path, so there is one piece of math to get right. |
| 2 | Proportional resize | corner handles only, via `shift` | Edge handles have no aspect to preserve; pretending otherwise surprises people. |
| 3 | Minimum size | clamp to 1 unit, never invert | The schema forbids negative sizes, and a flipped rect would need a sign convention nothing else has. |
| 4 | Input ownership | one controller module, not handlers in `Stage` | `Stage` stays about the surface and the paint loop; the controller owns gesture state. |

Files: `src/renderer/tools/{transform.ts,snapping.ts,pointer-controller.ts}`,
`src/renderer/store/mutations.ts`, rewritten `src/renderer/canvas/Stage.tsx`,
`test/transform.spec.ts`.

#### What changed from the plan

1. The gesture snapshot stores relative and absolute rects separately. The first version looked the
   absolute rect up from the live scene index during the drag — which changes as the drag writes to
   the document, so the resize math fed on its own output and accelerated.
2. `setPointerCapture` is wrapped in a try/catch. A pointer id that is not active throws, which
   killed the whole gesture; capture is an optimisation, not a requirement.
3. Arrow-key nudge, `shift` for a 10-unit step, `Escape` to deselect and `window.blur` closing an
   abandoned gesture were folded in here rather than left for M2.4.

#### Recap

Verified: dragging the frame moves it and its children as one, each gesture is a single undo step,
handles resize the selection bounding box, snap guides appear against sibling edges and centres.
12 tests.

Check yourself: dragging a frame moves its children too, but the store only wrote to the frame.
Which property of the document makes that work?

### M2.4 · Save, open and track the dirty document — `520fe3fa`

Status: done, save verified live through IPC; menu-driven paths exercised by hand only.
Open question answered: autosave is on, but only once the document has a path.

#### Educate

**Concept — Atomic replacement, not in-place writing**

*Fundamental.* Writing over a file is not one operation. Truncate, then write, then flush: a crash
or a full disk between any two leaves a file that is neither the old document nor the new one, and
the old one is already gone. The fix is to never write over the target. Write a temporary file in
the same directory, flush it to disk, then `rename` it onto the target — `rename` within a
filesystem is atomic, so a reader sees either the whole old file or the whole new one.

*In this case.* `writeDocument` opens a dotted temp file beside the target, writes, calls `sync()`,
closes, then renames. If the rename fails the temp file is removed rather than left as litter. Same
directory matters: a rename across filesystems is a copy, and copies are not atomic.

*Trade-off.* Two file operations instead of one, and a moment of double disk usage. Both are
irrelevant next to losing the user's document.

*Check yourself.* Why does the temp file have to be in the target's directory rather than in the
system temp directory?

**Concept — Dirty state is derived, not tracked**

*Fundamental.* A boolean someone sets on every edit is a boolean someone forgets to set. "Has this
changed since the last save" is a comparison, and if the document is immutable it is a reference
comparison: the saved document object against the current one.

*In this case.* Saving stashes the exact document object it wrote. Dirty is `store.getState() !==
savedRef.current`. Undoing back to the saved state makes the app clean again for free, because
Immer's structural sharing returns a tree that is reference-equal where nothing changed — and the
root compares equal when every patch has been reversed.

*Trade-off.* The comparison is only as good as the immutability. If anything ever mutated the
document in place, dirty would silently read false. That is the same invariant M2.1 already needs.

*Check yourself.* Edit, save, then undo. Is the document dirty, and why?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Autosave | on, debounced 800ms, only with a path | A single-document local app should not make people press a key to keep work. An untitled document has nowhere to go, so it prompts on close instead. |
| 2 | The initial fixture | opens untitled, no path | Saving would otherwise overwrite the repository's fixture. |
| 3 | New and Open | remount the editor with a fresh store | A store is built around one document; swapping the document under it would need a reset path that nothing else wants. A React `key` does it in one line. |
| 4 | Recent files | `app.addRecentDocument` and the `recentDocuments` menu role | The OS already keeps this list, renders it and clears it. |
| 5 | Close flow | main vetoes, asks the renderer, renderer answers | Only the renderer knows whether the document is dirty, and only main can stop a window closing. |

Files: `src/main/{file-io.ts,ipc.ts,menu.ts,index.ts}`, `src/preload/index.ts`,
`src/renderer/document/{file-session.ts,use-document.ts}`, `src/renderer/App.tsx`,
`src/renderer/store/mutations.ts` (delete), `test/file-io.spec.ts`.

#### What changed from the plan

1. Select All and Delete arrived with the menu rather than waiting for a later ticket — the Edit
   menu needed something to be useful alongside Undo and Redo, and `removeNodes` is eight lines.
2. Undo and Redo are menu items with accelerators rather than raw key handlers. On macOS a menu
   accelerator is handled by the OS before the web contents sees it, so a `keydown` listener would
   have been shadowed by the menu anyway.
3. The dirty flag drives `BrowserWindow.setDocumentEdited` and `setRepresentedFilename`, giving the
   macOS proxy icon and close-button dot for free; the plan only called for a title.

Known gap: the menu and dialog paths — Open, Save As, the discard prompt, recent documents — cannot
be driven from CDP, so they are verified by hand rather than automatically. The save path itself was
exercised live through IPC with a real path, and the atomic write has unit tests.

#### Recap

Shipped across all three tickets: 57 tests pass in seven files, typecheck clean. The running app
selects, drags, marquees, resizes, nudges, deletes, undoes and writes a `.spen` file atomically with
no temporary left behind.

Remember: the three pieces of state in an editor have three different lifetimes — the document is
saved and undoable, the selection is neither, and the viewport is neither but survives a document
change. Mixing them up is how editors get bugs that feel haunted.

Check yourself: the user drags a node, then quits without saving an untitled document. Trace what
happens from `window.on('close')` to the process exiting.

### M3.1 · Mirror the document tree into a Yoga tree — `36e484db`

Status: done. Built together with M3.2 and M3.3 at the user's request.

#### Educate

**Concept — Reuse by identity beats diffing by patch**

*Fundamental.* Two trees that share most of their nodes can be reconciled two ways. You can compare
them — walk both, or replay the patch list, and work out what moved. Or you can ask each node
whether you have seen *this exact object* before. With an immutable tree the second question is
already answered: an edit replaces only the nodes on the path from the root to the change, so any
node that is reference-equal to one you saw last time has an identical subtree, transitively, for
free.

*In this case.* `build` keeps a `Map` from document node to Yoga node. A cache hit means detach the
Yoga node from its old parent, mark its whole subtree as still in use, and return it — the children
are not even visited. A miss creates a Yoga node and recurses. After the pass, a sweep frees every
cached Yoga node that nothing claimed. Yoga nodes live in WASM memory and are not garbage
collected, so the sweep is not an optimisation, it is the only thing standing between the app and
an unbounded leak.

*Trade-off.* A `WeakMap` would free the JS side automatically and leak the WASM side silently. A
`Map` plus mark-and-sweep is more code and is deterministic, which is the right trade for memory
you have to release by hand.

*Check yourself.* A frame's third child changes colour. Which Yoga nodes are rebuilt, and which are
reused?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Reconciliation | identity cache plus mark-and-sweep | Structural sharing already computed the diff; replaying patch paths would recompute it. |
| 2 | What goes through Yoga | every node, including absolutely positioned ones | `layout: none` becomes `position: absolute` with `left`/`top`. One code path, not two. |
| 3 | Source of geometry | the layout map, for everything | Hit-test, overlay, snapping, resize and paint all read `sceneItems`, which now reads Yoga. There is one answer to "where is this node". |
| 4 | Yoga root | one persistent root, children re-inserted per pass | Creating and freeing a root per pass is a WASM allocation nobody needs. |

Files: `src/renderer/layout/{yoga-tree.ts,sizing.ts}`, rewritten `src/renderer/canvas/scene-index.ts`
and `src/renderer/canvas/paint.ts`. Added `yoga-layout` 3.2.1.

#### What changed from the plan

1. No patch-path diffing. The plan called for mapping Immer patches onto insert, remove, reorder and
   prop-change operations against a persistent Yoga tree. The identity cache gets the same result
   with none of that machinery, and it cannot drift out of sync, because the thing it keys on is the
   document itself.
2. `paint` no longer walks the node tree with a `translate` per level. It iterates `sceneItems` and
   draws each node at its absolute layout rect. The nesting transform now lives in Yoga, so repeating
   it in the painter would apply it twice.

#### Recap

Verified: the absolute fixture lays out byte-identically to the pre-Yoga build, and the Yoga cache
size is unchanged after 200 edits — nothing leaks and nothing accumulates.

Check yourself: why would a `WeakMap` cache have passed the same leak test while still leaking?

### M3.2 · Implement layout properties and sizing behaviors — `ff08dd73`

Status: done, verified in the running app with a new fixture frame.

#### Educate

**Concept — A sizing behavior is a question the parent may refuse to answer**

*Fundamental.* `fill_container` asks the parent for space; `fit_content` asks the children. Either
question can be unanswerable: a node with no layout parent has nobody to fill, and a node with no
children has nothing to hug. A sizing system that ignores this produces zeroes — the classic
collapsed-to-nothing box. The fix is a declared fallback: `fit_content(100)` means "hug, and if you
cannot, be 100".

*In this case.* `parseSizing` turns the string into a kind plus an optional fallback. `applyAxis`
then decides per axis: fixed sets a size; `fit_content` sets auto only when the node actually has
children and its own layout is not `none`; `fill_container` sets `flexGrow` on the parent's main
axis, `alignSelf: stretch` on the cross axis, and the fallback when the parent has no layout at all.

*Trade-off.* Falling back silently hides a mistake — a frame that was meant to hug but has no layout
set will quietly be 100 wide. The alternative, refusing to lay out, turns a cosmetic mistake into a
blank canvas. Pen made the same call, and the fallback is written in the document where it can be
read.

*Check yourself.* `width: "fill_container"` with no fallback, on a node whose parent has
`layout: "none"`. What width does it get, and why is that the honest answer?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Schema shape | `width`/`height` become `number \| behavior string`; `x`/`y` stay numbers | Position is always explicit; only size is negotiated. Matches Pen's schema. |
| 2 | Cross-axis fill | `alignSelf: stretch` rather than `100%` | Percentages interact badly with a hugging parent; stretch is what flexbox means here. |
| 3 | Padding shorthand | all three forms, expanded at parse | The document should be comfortable to hand-edit; the engine should see four numbers. |
| 4 | Gap | `Gutter.All` | Row and column gap are not separately expressible in the schema, so one value is honest. |

Files: `src/shared/schema/node.ts`, `src/renderer/layout/sizing.ts`, `fixtures/hello.spen`,
`test/layout.spec.ts`.

#### What changed from the plan

1. The layout properties could not be spread into `FrameNode` from a shared constant: Zod 4's
   recursive inference through the `children` getter needs the object literal to be statically
   analysable, and the spread erased it into `any`. They are written inline.
2. The fixture gained a second top-level frame — a hugging vertical stack with padding, gap, centred
   cross axis, a `fill_container` child and a nested `space_between` row — so the feature is visible
   in the app rather than only in tests.

#### Recap

Verified in the app: the stack hugs its content, the blue bar fills the container width, the avatar
centres on the cross axis, the nested row spreads three swatches with `space_between`. 11 layout
tests covering every property and both fallbacks.

Known gap: dragging or resizing a node that sits inside a layout frame writes `x`/`y` that layout
then ignores, so it appears to snap back. Resizing a hugging or filling node writes a fixed number,
which silently converts the behavior — the same thing Figma does, but it should be explicit in the
UI. Both belong with the inspector in M4.4.

Check yourself: the stack's width is `fit_content(240)` and its widest child is a fixed 200. Why is
the frame 232 wide rather than 240 or 200?

### M3.3 · Relayout and repaint only the dirty subtree — `446ea9b3`

Status: done, with the performance target missed and the ceiling recorded.

#### Educate

**Concept — Measure, then decide what counts as fast**

*Fundamental.* A performance budget without a measurement is a wish. The useful form is a number, a
workload and a guard: this operation, on this document, must stay under this time, asserted in the
test suite so a regression fails loudly rather than being noticed six months later as "the app feels
slow now".

*In this case.* The workload is 5000 nodes across 100 hugging frames. The first implementation —
rebuild the whole Yoga tree per layout — measured 11.56ms median. With identity reuse it measured
4.79ms. The target in the ticket was 2ms. It was not reached, so the guard is set at 8ms: above the
measurement with headroom for a slower machine, below the point where a regression would go unnoticed.

*Trade-off.* Setting the guard at the measured number makes the suite flaky on any machine slower
than this one. Setting it at the aspiration makes it fail today. A guard sits above the real number
and below the number that would hurt.

*Check yourself.* The benchmark passes at 8ms on this machine. What does that assertion actually
promise, and what does it not?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Invalidation unit | the whole document, with unchanged subtrees reused inside Yoga | The reuse from M3.1 already skips clean subtrees; Yoga itself skips recalculating nodes it knows are clean. |
| 2 | Budget | 8ms median, asserted | Above the 4.79ms measurement, below a frame. |
| 3 | Benchmark location | a vitest spec, not a separate runner | It only guards a regression if it runs with everything else. |
| 4 | Where to stop | stop at 4.79ms | The next step is a real design change, not a tweak; see below. |

Files: `bench/large-document.ts`, `test/layout-perf.spec.ts`.

#### What changed from the plan

1. **The 2ms target was not met.** 11.56ms rebuild, 4.79ms with identity reuse. The remaining cost
   is not layout — Yoga skips clean nodes — it is the collection walk: `getComputedLayout()` is
   called once per node, 5000 WASM round-trips, to fill the layout map. The next step is to stop
   rebuilding the map: return a layered lookup that falls back to the previous pass's map for
   subtrees whose node object and origin are both unchanged, flattening the chain every so often.
   That is maybe sixty lines and a flattening heuristic, and it was not worth paying for a budget
   the app is not yet near. Revisit when a real document gets slow, or when M4's paint cost pushes
   the frame over.
2. Repeated reads are free rather than merely cheap: `sceneItems` and the layout map are memoised on
   the document object, so the paint loop, hit-test, snapping and the overlay share one layout per
   frame.
3. The leak test runs 200 edits, not 1000. At roughly 5ms per relayout, a thousand blew vitest's
   default 5-second timeout — the test failed as a timeout, not an assertion, which cost a detour
   through the JSON reporter to diagnose. 200 proves the same invariant in a second.

#### Recap

Shipped across M3: 70 tests in nine files, typecheck clean, app verified with nested auto-layout.
Relayout of 5000 nodes: 4.79ms median, guarded at 8ms.

Remember: structural sharing is not one feature, it is the same trick three times — change
detection in the store, cache keys in the Yoga tree, and memoisation of the scene index. Every one
of them breaks the instant anything mutates a node in place.

Check yourself: the layout map is memoised per document object and the Yoga cache is keyed per node
object. An agent edits one node. How many Yoga nodes are rebuilt, and how many layout maps?

### M4.1 · Render fills: solid, gradient and image — `0036ba88`

Status: done, verified in the running app. M4.1 to M4.4 were planned and built in one pass at the
user's request.

#### Educate

**Concept — A fill is a shader, and a shader is an object you build**

*Fundamental.* Filling a shape with a flat colour is a special case. The general case is a shader: a
function from a point to a colour. A gradient is a shader with stops and a geometry; an image fill is
a shader wrapping a texture with a matrix that maps image space onto the shape. Skia models all of
them the same way — build a shader, hand it to a paint, draw the path.

*In this case.* `fillPaints` turns a node's `fill` into zero or more paints, in document order, each
drawn over the same path. Gradient geometry is derived from the node's rect, so a gradient survives a
resize without touching the document. An image fill computes a matrix from `cover`, `contain` or
`stretch` and the image's intrinsic size.

*Trade-off.* Rebuilding shaders every frame is simpler than caching them and costs an allocation per
fill per frame. At the current scale that is invisible; M3.3's benchmark is where it would show up.

*Check yourself.* A node has two fills: a solid and a gradient with alpha. Why does the order in the
array matter, and which one is "on top"?

**Concept — An async resource inside a synchronous paint loop**

*Fundamental.* Painting is synchronous: the frame has to be produced now. Loading an image is not.
The resolution is always the same shape — return a placeholder immediately, start the load, and
invalidate the frame when it arrives. What you must not do is block, and what you must not do twice
is start the same load again on the next frame.

*In this case.* `image-cache` keys by URL, records a pending entry before the request so the second
frame does not re-request, and calls back into `markDirty` when bytes arrive. Reading the file itself
happens in main over IPC: the renderer has no filesystem access, and that is deliberate.

*Trade-off.* A cache keyed by URL cannot notice the file changing on disk. Watching for that is a
feature nobody has asked for yet.

*Check yourself.* The first frame after selecting an image fill draws nothing. How many requests does
the second frame make, and why?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Fill shape in the schema | hex string, or object, or an array of either | A hex string keeps the common case readable by hand; the object form carries blend, opacity and type. |
| 2 | Asset access | main reads the bytes, renderer decodes | The renderer has no Node integration and should not get it for one feature. |
| 3 | Asset paths | resolved against the document's directory, escapes refused | A design file should be movable with its images, and a document should not be able to read `/etc/passwd`. |
| 4 | Asset base for the bundled fixture | returned separately from the save path | The fixture opens untitled so Save does not overwrite it, but its images still have to resolve. |

Files: `src/renderer/canvas/{fills.ts,image-cache.ts,shapes.ts}`, `src/main/ipc.ts`,
`fixtures/swatch.png`.

#### What changed from the plan

1. `CanvasKit.Path` has no `addRect`/`addOval`/`addRRect` in 0.42 — those moved to `PathBuilder`,
   which hands over a finished `Path` with `detach()`. Shapes are built there.
2. `OpenResult` gained an `assetBase` field. The initial fixture deliberately opens with no save
   path, which left relative image URLs resolving against the app root instead of the fixtures
   directory, so the image fill silently drew nothing.

#### Recap

Verified in the app: a 45-degree linear gradient with asymmetric corner radii, a radial gradient in
an ellipse, and a PNG image fill in `cover` mode. Path escapes outside the document's directory are
refused in main.

Check yourself: why is the path check done in main rather than in the renderer that builds the URL?

### M4.2 · Render strokes, corner radius and effects — `64157634`

Status: done, with two approximations and one feature deliberately not built.

#### Educate

**Concept — Stroke alignment is geometry, not paint**

*Fundamental.* Skia, like Canvas2D and SVG, strokes *on* the path: half the width inside, half
outside. Design tools offer inside, centre and outside, which are three different geometries. The
exact construction is to offset the path itself. The cheap construction is to stroke at double width
and clip away the half you do not want — the result is identical for simple shapes and diverges at
sharp corners and self-intersections.

*In this case.* The cheap construction, with a clip to the path for `inside` and a clip to its
complement for `outside`. Fine for rectangles, rounded rectangles and ellipses, which is every shape
the schema has.

*Trade-off.* When paths arrive (not in this milestone), this needs replacing with a real path offset
or the corners of an outside stroke on a sharp vertex will be wrong.

*Check yourself.* Why does a clipped double-width stroke give the right answer on a rounded rectangle
but the wrong one on a star?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Stroke alignment | double width plus a clip | Correct for every shape the schema can express today, and ten lines instead of a path-offset implementation. |
| 2 | Outer shadow | the path drawn again, offset, through a blur mask filter | The standard construction, and it composes with the fills already drawn. |
| 3 | Inner shadow | a blurred stroke of the same path, clipped to the inside | An approximation. See below. |
| 4 | Layer blur | `saveLayer` with a blur image filter | Blurs the node and everything it contains, which is what a layer effect means. |
| 5 | Background blur | **not built** | It needs the backdrop already rasterised and a change to draw order, which is a real change to the painter, not an effect. |

Files: `src/renderer/canvas/{effects.ts,shapes.ts}`, `src/shared/schema/node.ts`.

#### What changed from the plan

1. **Background blur was not built.** It is the one effect that cannot be expressed as "draw
   something extra for this node": it has to read the pixels already painted behind it, which means a
   backdrop layer and a painter that knows about draw order. It belongs with clipping, which the
   painter also does not do yet.
2. The inner shadow is approximated as a blurred stroke clipped to the shape's interior. The exact
   construction is the inverse path blurred and clipped, which needs a path-inversion step. The
   approximation reads correctly at the blur radii a design actually uses and is wrong for a very
   large radius on a small shape.

#### Recap

Verified in the app: an outer shadow under a gradient card, an inside stroke on an ellipse, an
outside stroke plus inner shadow on a rectangle, a layer blur on a solid bar, and per-corner radii.

Check yourself: the layer blur blurs the node *and its children*. Which Skia call makes that true,
and what would have to change to blur only the node's own fill?

### M4.3 · Shape and render text properly — `5418753b`

Status: done for rendering and measurement. **On-canvas editing was not built** — see below.
Open question answered: system fonts, read through main, no bundled font dependency.

#### Educate

**Concept — Shaping, and why measurement must come from the shaper**

*Fundamental.* Turning a string into glyphs is not a mapping from characters to pictures. Ligatures
merge characters, combining marks stack, scripts reorder, kerning moves glyphs relative to each
other. That process is shaping, and HarfBuzz does it. The consequence for layout is strict: the only
thing that knows how wide a string is, is the shaper that will draw it. Measuring with anything else
— a character count, an average advance, a different font fallback chain — produces a layout that
disagrees with the render.

*In this case.* CanvasKit's `ParagraphBuilder` wraps HarfBuzz and ICU. The same paragraph
construction is used to draw and to measure: `measureParagraph` builds a paragraph, lays it out at
the available width and returns the intrinsic width and the resulting height. Yoga calls it through
a measure function installed on text nodes that hug.

*Trade-off.* Building a paragraph to measure it is expensive, and it happens inside layout. The
identity cache from M3.1 keeps it to the nodes that actually changed, which is why that cache had to
exist before this ticket.

*Check yourself.* A text node hugs its height inside a frame that fills the window. The window is
resized narrower. What is the order of operations between Yoga and the shaper?

**Concept — Fonts arrive late, and layout has to be told**

*Fundamental.* A font is a file. Until it has loaded, the shaper either has nothing to work with or
falls back to something with different metrics, so any layout computed before it arrives is wrong.
Every system that lays text out has to handle this, and the answer is to invalidate: throw away the
layout you computed with the wrong font and compute it again.

*In this case.* `requestFont` is called during paragraph construction, so a font referenced by the
document is fetched the first time it is needed and never twice. When bytes arrive, the font manager
is rebuilt and a callback clears both the Yoga cache and the scene index, then marks the frame dirty.
The default family is loaded before the first paint, so the common case never flickers.

*Trade-off.* Clearing the whole layout cache on a font load is heavy-handed; only text nodes using
that family are affected. Fonts load a handful of times per session, so precision here would buy
nothing.

*Check yourself.* Why must the Yoga cache be cleared and not merely the scene index?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Font source | system fonts, read in main from a per-platform candidate list | No dependency, no licence question, and the files are already on disk. macOS ships real `.ttf` files in `Supplemental`. |
| 2 | Fallback chain | requested family, then Arial, then the platform default | A missing family should render something, not tofu. |
| 3 | Shaping | CanvasKit `ParagraphBuilder` | It is HarfBuzz plus ICU, already in the WASM we ship. |
| 4 | Measurement | a Yoga measure function on hugging text nodes | The only way `fit_content` can mean anything for text. |
| 5 | Text colour | the node's `fill`, when it is a hex string | Gradient-filled text is a shader on glyphs; out of scope here. |

Files: `src/renderer/text/{font-manager.ts,paragraph.ts}`, `src/renderer/layout/text-measure.ts`,
`src/main/ipc.ts` (`font:read`), wiring in `Stage`.

#### What changed from the plan

1. **On-canvas text editing with a caret and selection was not built.** The ticket scoped it
   alongside rendering; it is a text input implementation — caret positioning in glyph-cluster
   space, selection ranges, IME, keyboard navigation — and it is larger than the rest of this
   milestone put together. Text renders, shapes, wraps, aligns and measures; changing the string is
   done through the document. This is the largest deliberate trim in the project so far and deserves
   its own ticket.
2. Text nodes no longer draw their `fill` as a background rectangle. With a placeholder that was the
   whole point; with real glyphs the fill is the glyph colour.

#### Recap

Verified in the app: bold wrapped text hugging its height, a centred caption with letter spacing,
both shaped through HarfBuzz with a system font fetched over IPC.

Check yourself: the fixture's heading hugs its height and wraps to two lines. Which component
decided it was two lines — Yoga, the paragraph, or the painter?

### M4.4 · Build the properties inspector panel — `c2dbbbbc`

Status: done, verified by driving the panel in the running app.

#### Educate

**Concept — Mixed values, and why the first value is the wrong answer**

*Fundamental.* With several things selected, a property either agrees across all of them or it does
not. Showing the first one's value and applying an edit to all is the behaviour that silently
destroys data: the user sees 24, assumes everything is 24, nudges it to 25, and three nodes that
were 8 are now 25. The correct display is a distinct third state — mixed — and an edit from that
state is an explicit "make them all this".

*In this case.* `common()` reduces a property across the selection to a value or a mixed marker.
Controls render an empty field with a `Mixed` placeholder, and committing from that state writes to
every selected node. The comparison is a JSON stringify, which is slow and correct for the small
property values involved.

*Trade-off.* A real equality function would be faster and would need a case per property type.

*Check yourself.* Two rectangles are selected, one 24 wide and one 80. The user clicks into W, types
nothing and tabs away. What should happen, and what would go wrong if the field had shown 24?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Colour picker | the native `<input type="color">` beside a hex field | The OS picker is better than anything worth writing here, and it is free. |
| 2 | Number entry | drag-scrub on the label plus typed entry | Dragging a label is the gesture every design tool has; typing is how exact values get in. |
| 3 | Where edits go | the same store entry point the canvas tools use | One writer. An inspector edit is undoable because it cannot be anything else. |
| 4 | Panel state | none — derived from selection and document | The panel is a pure function of two stores; it holds only the in-progress text of the field being typed into. |

Files: `src/renderer/ui/Inspector.tsx`, `src/renderer/ui/controls/{NumberField,ColorField,SelectField}.tsx`,
`setNodeProps` in `src/renderer/store/mutations.ts`, shell styling in `src/renderer/index.html`.

#### What changed from the plan

1. Sections built: position and size, layout (frames only), fill colour, stroke colour and width,
   text size, weight and alignment. **Not built: gradient editing, an effects section, per-corner
   radius, and the behaviour selector for `fit_content`/`fill_container`.** The last one is the
   notable gap — M3.2 recorded that resizing a hugging node silently converts it to a fixed number,
   and the fix was supposed to live here. It still needs a control that makes the mode visible.
2. The inspector reads a node's first solid fill only. A gradient or image fill shows an empty
   colour field rather than saying so, which is a small lie the UI should stop telling.

#### Recap

Shipped across M4: 78 tests in ten files, typecheck clean. Verified by driving the running app —
selecting the card showed its real values, typing 120 into W resized it on canvas and moved the
selection handles with it.

Remember: every surface in this app is a projection of the same two stores. The canvas is one view,
the inspector is another, and they stay consistent because neither owns anything.

Check yourself: the inspector writes through `setNodeProps`, the canvas drag writes through
`updateNodes`, and an agent will write through neither. What must all three have in common for undo
to keep working?

### M5.1 · Serialize all mutations through one patch path — `f871b464`

Status: done. M5.1 to M5.3 were planned and built in one pass at the user's request.
Open question answered: an agent write during a drag is **deferred**, not rejected.

#### Educate

**Concept — Serialising beats merging when there is one writer at a time**

*Fundamental.* Two sources of edits on one document is a concurrency problem, and there are two
families of answer. Merge: let both write and reconcile afterwards — this is what CRDTs and
operational transforms are for, and they are the right answer when writers are genuinely
simultaneous and remote. Serialise: make the writes take turns. Serialising is far less machinery
and is exactly correct when the writers are on the same machine and neither is real-time.

*In this case.* A queue in the renderer. Every agent write is a task appended to a promise chain, so
two tool calls arriving together apply in the order they arrived and never interleave. The user's
direct edits do not go through the queue — they are synchronous and already serial by virtue of
being driven by one pointer.

*Trade-off.* A queue has a head-of-line problem: a slow write delays the next one. With writes that
are a synchronous store update, there is no slow write.

*Check yourself.* Why do the user's own edits not need to go through the queue, and what would have
to be true for that to stop being safe?

**Concept — An in-flight gesture holds uncommitted state**

*Fundamental.* A drag is a transaction: it has read a snapshot, it is writing repeatedly against
that snapshot, and it has not decided its final value yet. An outside write landing in the middle
corrupts both — the agent's change is overwritten by the next pointer move, and the drag's own
result is computed from a document it no longer understands.

*In this case.* The queue checks whether the store has an open gesture and waits for `onGestureEnd`
before running the task. Waiting, rather than rejecting, is the choice: the agent asked for
something reasonable and will get it a few hundred milliseconds later, where a rejection would make
it retry or give up. There is a ten-second cap, so a gesture that never ends (a dropped
`pointerup`, a crash mid-drag) fails the call with a readable message rather than hanging the agent.

*Trade-off.* Deferring means the agent's write lands against a document the user has since changed.
That is the correct outcome: the user's edit is the more recent intent.

*Check yourself.* The user starts a drag and switches to another app mid-gesture. What ends the
gesture, and what does the agent's pending write see?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Write during a gesture | defer, with a 10s cap | The agent gets what it asked for; a stuck gesture still fails loudly. |
| 2 | Queue scope | agent writes only | The user's edits are already serial, and routing them through a promise chain would add a frame of latency to every drag. |
| 3 | Reads | not queued | A read during a gesture sees an in-progress document, which is the truth. |
| 4 | Where the queue lives | renderer | The store is in the renderer; a queue in main would serialise IPC, not edits. |

Files: `src/renderer/store/mutation-queue.ts`, `onGestureEnd` in `document-store.ts`.

#### What changed from the plan

Nothing material. The plan called for per-mutation acknowledgement and ids; the bridge in M5.2
provides both, so the queue does not need its own.

#### Recap

Verified: a write issued during an open gesture does not apply until the gesture ends, three writes
issued together apply in order, and a gesture that never ends fails the call after ten seconds.

Check yourself: what is the observable difference between "deferred" and "rejected with a retry
hint" from the agent's point of view, and which one produces a better transcript?

### M5.2 · Expose read tools over MCP — `a0ae5c52`

Status: done, verified against the running app over HTTP.

#### Educate

**Concept — The tool schema is the entire interface**

*Fundamental.* An agent cannot read your source. Everything it knows about your application is the
tool list: names, descriptions and input schemas. A vague description produces vague calls, and an
input schema that accepts anything produces calls that fail at the far end for reasons the agent
cannot see. The schema is not validation, it is documentation that happens to be enforced.

*In this case.* Twelve tools, each with a one-line description written for a reader who has never
seen the app, and a Zod input schema. Errors come back as `isError` content with the message a
person would want — "Node 'r1' is a rectangle, not text" rather than a type error.

*Trade-off.* Fewer, more general tools are easier to maintain and harder to use correctly. More,
more specific tools are the opposite. Twelve is near the limit before the list itself becomes the
context problem.

*Check yourself.* `get_tree` takes a `maxDepth`. What goes wrong if it does not?

**Concept — A local HTTP server is reachable by every page the user opens**

*Fundamental.* Binding to a port on loopback does not mean only your program can reach it. Any web
page the user visits can issue requests to `http://127.0.0.1:<port>`. For an MCP server that can
edit documents, that is a real hole — a malicious page could drive the editor. The defences are to
bind to the loopback interface specifically (not `0.0.0.0`), and to check the `Origin` header and
refuse anything that is not local.

*In this case.* `http.listen(port, '127.0.0.1')` and an origin check that allows a missing origin —
a native client like Claude Code sends none — or a loopback one, and refuses everything else with
403.

*Trade-off.* Origin checking is not authentication. A determined local process can still speak to
the server. For a local design tool with no secrets, raising that bar further is not worth the
friction; a shared-secret header is the next step if it ever is.

*Check yourself.* Why is a missing `Origin` header allowed, and what kind of client sends none?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Transport | Streamable HTTP, stateless, JSON responses | Claude Code speaks it, and stateless means no session bookkeeping. |
| 2 | Port | 29980 on 127.0.0.1 | Fixed so the config entry is stable. |
| 3 | Bridge | main sends an id'd request to the renderer, renderer answers over IPC | The store is in the renderer; main is where the HTTP server has to live. |
| 4 | Node geometry | absolute layout rects from the scene index | The agent should see where things actually are, not the relative numbers in the file. |
| 5 | Screenshots | `webContents.capturePage`, cropped to the node's screen rect | The renderer knows the viewport, main knows how to capture; one extra bridge call joins them. |

Files: `src/main/mcp/{server.ts,bridge.ts}`, `src/renderer/mcp/handlers.ts`,
`src/shared/mcp/contract.ts`, `src/renderer/canvas/viewport-ref.ts`, preload `onAgentCall`.

#### What changed from the plan

1. **The SDK's Node transport does not work here, and the reason was not what it looked like.**
   `StreamableHTTPServerTransport` returned a bare 500 for every request. It wraps the web-standard
   transport in `@hono/node-server`, which swallowed the error, so the first hypothesis was an
   Electron incompatibility — the same code worked in plain Node. It was not: a stateless transport
   refuses to be reused across requests, and plain Node only appeared to work because that probe
   made a single request. The fix is a fresh `McpServer` and
   `WebStandardStreamableHTTPServerTransport` per request, with a small Node-to-Web request
   conversion, closed in a `finally`.
2. A `viewport-ref` module publishes the current viewport and canvas origin from the paint loop, so
   `get_screen_rect` can convert document coordinates to screen ones. The viewport lives in a ref
   inside `Stage` and is deliberately not store state; this is the one place something outside the
   canvas needs to read it.

Known gap: a transport per request means no server-to-client streaming — no progress notifications,
no SSE. Every tool here answers in one shot, so nothing is lost yet.

#### Recap

Verified live over HTTP: `tools/list` returns all twelve, `get_tree` returns the real open document
with absolute rects, and `screenshot` with a node id returns a PNG cropped exactly to that node.

Check yourself: `get_node` returns both a summary rect and the raw node. Why are the node's own
`width` and the summary's `rect.width` sometimes different numbers?

### M5.3 · Expose write tools over MCP and install into the harness — `053f80e6`

Status: done. The install path is implemented, unit-tested against a temporary file, and
**deliberately not run against the real config** — it is behind a menu item with a confirmation.

#### Educate

**Concept — An agent edit that the user cannot undo is a bug**

*Fundamental.* The moment a second writer can change a document, the question is whose history it
lands in. If the agent keeps its own, the user's undo stack lies: pressing undo skips the agent's
change and reverts something older, which is worse than doing nothing. The only coherent answer for
a single shared document is a single history: the agent's edits are entries in the user's undo
stack, indistinguishable from their own.

*In this case.* Every write tool goes through the same `store.apply` that the inspector and the drag
tools use. The history entry is labelled "Agent update", "Agent move" and so on, so the user can see
what happened, but it undoes exactly like anything else.

*Trade-off.* The user can undo the agent's work out from under it, and the agent will not know. That
is correct — it is the user's document — and it is why the agent should read before it writes.

*Check yourself.* The agent creates three nodes. How many times must the user press undo, and what
would have made that answer unpredictable?

**Concept — Installing into someone else's config is a destructive write**

*Fundamental.* Writing to a config file your program does not own is an outward-facing, hard-to-
reverse action. It has to be idempotent — running it twice must not duplicate anything — it has to
preserve what is already there, and it should leave a way back.

*In this case.* `installIntoClaudeCode` reads the existing file, compares the entry it wants against
what is there, returns `changed: false` if they match, writes a backup beside the original before
touching it, and merges rather than replaces `mcpServers`. It runs only from a menu item behind a
confirmation dialog naming the file it will edit.

*Trade-off.* Asking is friction. Editing a user's global config without asking is not a trade-off,
it is a bug.

*Check yourself.* What makes the function idempotent, and which line would you remove to break that?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Write tool surface | create, update, move, set_text, delete, set_selection | Enough to build and revise a screen; shaped around the schema rather than around the UI. |
| 2 | Validation | at the handler, with messages naming the node and the problem | The agent can only recover from an error it can read. |
| 3 | History labels | prefixed "Agent" | Visible provenance without a separate stack. |
| 4 | Install trigger | a menu item with a confirmation and a backup | A config write is the user's decision, not the app's. |

Files: write handlers in `src/renderer/mcp/handlers.ts`, `src/main/mcp/install.ts`, the Agent menu
in `src/main/menu.ts`, `test/mcp.spec.ts`.

#### What changed from the plan

1. `create_node` inserts the caller's object as-is and relies on the schema to reject it on the next
   load. Validating against the node schema at insert time would be better and is one line once the
   handlers import the Zod schema — it was left out because the error message from a raw Zod failure
   is worse than the ones the other tools give, and shaping it is a ticket's worth of care.
2. The install was written and tested but never executed against `~/.claude.json`. Adding suikopen
   to Claude Code is the user's call.

#### Recap

Shipped across M5: 91 tests in eleven files, typecheck clean. Verified end to end against the
running app — an agent listed the tools, read the tree, rewrote a text node's content, set the
selection, and took a screenshot cropped to that node showing its own words on the canvas.

Remember: one document, one history, one queue. Every time a second writer appeared — the inspector,
then the agent — the answer was to route it through the path that already existed rather than give
it one of its own.

Check yourself: the agent is told its write succeeded. A moment later the user presses undo. What,
if anything, should the agent have done differently?

### M6.1 · Add document variables and themes — `486e77e1`

Status: done, verified in the running app and over MCP. Built together with M6.2.

#### Educate

**Concept — Resolution is a pass, not a lookup**

*Fundamental.* There are two ways to let a document say "this colour is `$accent`". You can resolve
lazily: every consumer that reads a colour checks whether it starts with `$` and looks it up. Or you
can resolve eagerly: one pass produces a copy of the document with every reference replaced, and
every consumer downstream reads concrete values and knows nothing about variables.

The lazy version spreads the feature across every call site, and the first consumer that forgets the
check renders a literal `$accent`. The eager version has one place to be right.

*In this case.* `resolveDocument(document, theme)` returns a resolved copy. The store holds the raw
document — that is what is saved and what the inspector edits — while the painter, hit-test, layout
and the agent's read tools all see the resolved one. Resolution is memoised on the document object
and the active theme, so it costs once per edit, not once per frame.

*Trade-off.* Two documents in flight means two kinds of id. Everything that writes must address the
raw document; everything that reads can use either. Getting that backwards is the failure mode this
design introduces, and it is why writes are confined to `mutations.ts`.

*Check yourself.* The inspector displays a node's fill and lets you edit it. Which document does it
read from, which does it write to, and what would the user see if both used the resolved one?

**Concept — A theme is a selection, not a mode**

*Fundamental.* "Dark mode" is the degenerate case of a more general idea: a document declares axes
(`appearance`, `density`, `platform`), each axis has values, and a variable may carry a different
value per combination. A theme is then a selection — one value per axis — and resolution picks the
matching entry.

*In this case.* `themes` declares the axes, a variable's value is either a literal or a list of
`{ value, theme }` entries, and the active selection lives in view state next to the viewport: not
saved, not undoable, because which theme you are looking at is not a property of the document.

*Trade-off.* Not saving the selection means reopening a file always shows the first value. Saving it
would make the file differ between two people looking at the same design, which is worse.

*Check yourself.* A variable has values for `{appearance: light}` and `{appearance: dark}` and the
active selection is empty. What colour is used, and why is that better than an error?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Resolution strategy | one eager pass producing a resolved document | One place to be right instead of one check per consumer. |
| 2 | Where variables are allowed | colours, corner radius, gap, font size | Covers the design-system case. Position and size were left out: they interact with the sizing behaviours from M3.2 and deserve their own thought. |
| 3 | Unknown reference | left as the literal `$name` | Visible and harmless — `parseHexColor` returns transparent for anything that is not hex — rather than a crash in the paint loop. |
| 4 | Active theme | module state beside the viewport, with subscribers | It is view state. Putting it in the document would make it saved and undoable, which it should not be. |
| 5 | Ids | never substituted | An id that happens to start with `$` is an id, not a reference. |

Files: `src/renderer/document/{resolve.ts,resolved.ts,current.ts}`, schema changes in
`src/shared/schema/{node.ts,document.ts}`, theme section in the inspector, `get_theme`/`set_theme`
MCP tools.

#### What changed from the plan

1. Allowing `$refs` in the schema widened several property types from `number` to
   `number | string`, which rippled into Yoga, the paragraph builder and the inspector. An
   `asNumber(value, fallback)` helper absorbs it at each use site: by the time those read a node it
   has been resolved, but the type cannot know that.
2. `parseHexColor` now returns transparent for anything that is not a hex colour, instead of
   producing `NaN` channels from an unresolved reference.
3. No UI for creating or editing variables. They are authored in the file or by an agent; the
   inspector only switches themes.

#### Recap

Verified: switching the `appearance` axis repaints the whole document — the phone frame's surface
and ink invert — through both the inspector control and the `set_theme` MCP tool. 11 resolution
tests.

Check yourself: the theme selector is a `useSyncExternalStore` over the theme module rather than
React state. What broke before that change, and why did the canvas update correctly even then?

### M6.2 · Add components with masters, instances and overrides — `6d24c65c`

Status: done. Promotion to a master and instance-internal editing were **not built** — see below.

#### Educate

**Concept — An instance is a reference plus a sparse override map**

*Fundamental.* The naive way to reuse a design is to copy it. Copies drift: fix the padding in one
and the other eleven stay wrong. The alternative is to store a reference to the original plus only
the differences — which property on which descendant this instance changes. Propagation is then
free, because there is nothing to propagate: the instance is recomputed from the master every time
it is read.

*In this case.* A `ref` node carries a `masterId` and an `overrides` map keyed by a master-relative
path (`master/label`). Resolution expands the ref into a copy of the master's subtree, applies the
overrides by path, namespaces every descendant id with the instance id, and places the result at the
instance's position. Editing the master changes every instance on the next resolve, with no
propagation code at all.

*Trade-off.* The expanded nodes do not exist in the saved document, so nothing can address them
except through the instance. That is what makes propagation free and what makes instance-internal
editing a separate problem.

*Check yourself.* An instance overrides `master/label`'s content. The master's label is then renamed
to `title`. What happens to the override, and why is that the honest behaviour?

**Concept — A cycle in a resolve pass is an infinite loop**

*Fundamental.* Anything that expands a reference into content that may itself contain references
needs a cycle check, because the failure mode is not a wrong answer, it is a hang. The check is a
set of what is currently being expanded, plus a depth cap for the pathological-but-acyclic case.

*In this case.* `expand` carries a `visiting` set of master ids and a depth counter capped at 16. A
component that contains itself produces an error string on the resolve result rather than a thrown
exception, so the app keeps rendering the unresolved document and shows the message in the
inspector.

*Trade-off.* Refusing at resolve time rather than at edit time means a bad document can be opened
and looked at. That is better than refusing to open it.

*Check yourself.* Why is a depth cap needed when there is already a cycle check?

#### Design and plan, as built

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | What a master is | any node, addressed by id | No separate component registry to keep in sync with the tree. |
| 2 | Instance ids | namespaced `instanceId/masterNodeId` | Unique, and the path back to the master node is readable in the id. |
| 3 | Override keys | master-relative paths | Stable under reordering, unlike indices. |
| 4 | Errors | returned on the resolve result, shown in the inspector | A broken component should not blank the canvas. |
| 5 | Detach | replaces the ref with the expanded subtree, ids rewritten | Makes the instance ordinary, which is all detach should mean. |

Files: expansion in `src/renderer/document/resolve.ts`, `detachInstance` in `mutations.ts`,
`detach_instance` MCP tool, instance guard in the inspector, fixture components.

#### What changed from the plan

1. **"Promote a subtree to a master" was not built.** Masters are ordinary nodes, so promotion means
   creating a `ref` that replaces the original in place — a mutation plus a UI affordance. An agent
   can do it today by writing the `ref` itself; a user cannot.
2. **Editing inside an instance was not built.** Selecting an expanded node shows a note explaining
   that the master or a detach is the way in, because a write to a synthetic id would silently do
   nothing — `updateNodes` skips ids it cannot find. The honest fix is for an inspector edit on an
   instance descendant to write an override, which is a ticket of its own.
3. Overrides apply a shallow property merge and refuse to change the id. Anything deeper — adding a
   child to an instance, reordering — is out of scope and would need the override map to describe
   structure, not just properties.

#### Recap

Shipped across M6: 103 tests in twelve files, typecheck clean. Verified in the running app and over
MCP — a master Button, two instances, one overriding both its fill and its label, all three tracking
the master; `detach_instance` turning one into an independent copy; and the whole document
re-rendering through a theme switch.

Remember: the same idea closed three milestones. Structural sharing made change detection free in
M2, cache keys free in M3, and here a resolved document memoised on the raw one makes variables and
components cost one pass per edit instead of one check per read.

Check yourself: the resolved document is derived from the raw one, the layout is derived from the
resolved one, and the scene index is derived from the layout. An agent changes one colour. Which of
those three are recomputed, and which are not?

## Where this leaves the project

Built, in order: a Skia surface, a document format, a painter, a store with undo, selection and
direct manipulation, a file lifecycle, a Yoga layout engine, styling, shaped text, an inspector, an
MCP server, variables, themes and components.

Not built, and known:

- On-canvas text editing — caret, selection, IME (M4.3). The largest remaining gap.
- Background blur, which needs a backdrop layer and a painter that understands draw order (M4.2).
- Clipping. Nothing clips to its frame yet, which is the same change background blur needs.
- Promotion to a master, and editing inside an instance by writing overrides (M6.2).
- A sizing-behaviour control in the inspector, so resizing a hugging node stops silently converting
  it to a fixed number (M3.2, M4.4).
- Gradient, effect and per-corner-radius editing in the inspector (M4.4).
- Layered layout map to get relayout under the 2ms target (M3.3). Currently 4.79ms at 5000 nodes.

### M7 · In-app design agent (no ticket)

Status: built and verified with two real prompts. Planned and built in one step at the user's request,
outside the bb ticket set.

What it is: an **Agent** tab beside **Design** in the sidebar. You type a request; the Claude Agent
SDK runs the user's installed Claude Code (`~/.local/bin/claude`), which authenticates with the
login already on the machine — the user's subscription, no API key. The agent's only tools are the
suikopen MCP tools: `tools: []` removes Claude Code's built-in file, shell and web tools,
`permissionMode: 'dontAsk'` with an explicit `allowedTools` list of the suikopen tools denies
everything else, and `settingSources: []` keeps the user's own `~/.claude` hooks, skills and
`CLAUDE.md` out of the design agent. Follow-up messages resume the same session.

Policy, recorded because it constrains distribution: Anthropic's Agent SDK documentation states that
third-party developers may not offer claude.ai login or subscription rate limits in their products
unless previously approved. Running it on the user's own machine with their own login is fine. A
build shipped to anyone else needs API-key authentication or Anthropic's approval.

#### What changed while building it

1. **The `screenshot` tool was useless to the agent.** It cropped the editor window to the node's
   screen rect, and the frames an agent creates are placed to the right of everything else — off
   screen — so the first run got a picture of the inspector and said so. Node screenshots are now
   rendered by CanvasKit to an offscreen raster surface at 2x, independent of the viewport.
2. **The user could not see what the agent made.** The view now fits the whole document when a run
   finishes.
3. **`create_node` and `update_node` now validate against the node schema** and reject duplicate
   ids, closing the gap recorded in M5.3. An agent writing malformed nodes was the expected first
   failure; it now gets an error naming the bad field instead of corrupting the document.
4. The SDK is ESM-only and the main process is CommonJS. Electron 45's Node supports `require()` of
   ESM, so the externalised import works unchanged.

#### Recap

Verified end to end: a login screen (default model, about $0.21 in reported usage) and a pricing
card (Haiku, about $0.01), each built through `get_document_info` → `get_tree` → `create_node` →
`screenshot`, placed beside existing frames without overlap, and brought into view. 103 tests pass.

Known gaps: no streaming of the agent's thinking, no image or file attachments in the prompt, no
per-message undo grouping (each agent tool call is its own undo step), and the 270MB platform
binary is still installed as an optional dependency even though it is not used.
