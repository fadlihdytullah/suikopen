# Grand design — per-document agent memory and automatic compaction

Status: all three milestones built (8 of 8 tickets done). 189 tests pass; Memory panel checked in a debug instance. Compaction not yet tried against a real provider.
Last synced: 2026-10-29.

## Big picture

Each `.spen` file carries its own memory: short notes about brand, decisions and conventions that every
agent (Claude, Codex, Gemini) reads at the start of a run and can add to through MCP. Long chats compact
themselves: the app summarises the chat into a handoff plus memory notes, then continues in a fresh
provider session that starts from the handoff.

```
 .spen
 ├─ children, variables, themes …
 └─ memory: [{ id, key?, kind, text, by, at }]       capped ~2k tokens

 Renderer (tab)                    Main                          Provider
 ┌──────────────┐  run request    ┌───────────────────┐  prompt  ┌────────┐
 │ store.memory │───────────────▶ │ systemPrompt      │────────▶ │ agent  │
 │ Memory panel │                 │  + <memory> block │          │        │
 └──────▲───────┘                 │  + handoff        │          └───┬────┘
        │  get_memory / remember / forget (MCP, routed per tab)      │
        └────────────────────────────────────────────────────────────┘

 run done ─▶ usage ≥ threshold? ─▶ compact run ─▶ { handoff, notes[] }
                                                  ├─ notes ─▶ store.memory
                                                  └─ chat: sessionId = null, handoff saved
```

### What changes in existing code

- New: `memory` field in `DocumentSchema` (optional, stays `version: 1`), MCP tools `get_memory`,
  `remember`, `forget`, a Memory panel, `src/main/agent/compact.ts`.
- Changed: `systemPrompt()` (memory block + handoff), `ChatRecord` (usage, handoff, compactions),
  providers report token usage, `AgentPanel` (divider "Earlier messages summarised", "Compact now").
- Riskiest: memory is file content injected into the prompt. A shared `.spen` could carry hostile
  instructions. Mitigation in M1: delimited block marked as notes, not instructions; panel shows every note;
  caps on size.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-29 | Memory lives inside the `.spen` file | Travels with copy, git and rename; no orphan sidecar |
| 2026-10-29 | Agent writes via `remember`, compaction also extracts notes | Explicit notes for intent, extraction so nothing is lost |
| 2026-10-29 | Compaction triggers on token usage from provider, char estimate as fallback; plus manual "Compact now" | Same behaviour across providers, survives app restart |
| 2026-10-29 | User can view, edit and delete every note in a Memory panel | Trust and privacy; fixes wrong or stale notes |
| 2026-10-29 | Notes with the same `key` replace each other | Stops piling up contradictions |
| 2026-10-29 | Manual compaction button removed; compaction is automatic only | User wants no manual control; the icon read as a close button |
| 2026-10-29 | Memory edits stay outside undo but mark the file dirty | ⌘Z on a design should not erase what the agent learned |
| 2026-10-29 | Caps: 50 notes, 280 chars, 8k chars total; bad notes repaired on open, never reject the file | Small prompt, old or hand-edited files still open |
| 2026-10-29 | Compact at 75% of a per-provider window (Claude 200k, Codex 272k, Gemini 1M) | Room for the summary run itself |
| 2026-10-29 | Compaction resumes the provider session; sends the transcript only when there is no session | Summary sees the full context, including tool results |

## Decided before build

| Question | Options | Recommendation |
|---|---|---|
| Memory edits in undo history? | A. Undoable like any edit / B. Marks file dirty but outside undo | **B**: ⌘Z on a design should not erase what the agent learned |
| Caps | Notes count / text length / total | 50 notes, 280 chars each, ~2k tokens total; oldest unkeyed note drops first |
| Compaction threshold | 60% / 75% / 85% of model context window | **75%**: leaves room for the summary run itself |

## Concepts this rests on

- Context window and compaction: summarise old turns so the model keeps working past its window.
- Durable vs working memory: notes (long-lived, per file) vs handoff (per chat, replaces history).
- Prompt injection from data: file content reaching the prompt must be framed as data.
- Keyed upsert: one note per key, newest wins.

## Milestones

**M1 · Durable memory per file.** Schema, store, save/load, MCP tools, prompt injection.
After it: the agent remembers brand and decisions for this file across chats, providers and restarts.
Risk: prompt injection via shared files; schema change must open old files.

**M2 · Memory panel.** View, edit, delete, add notes; signal when the agent remembers something.
After it: the user sees and controls what the agent knows. Risk: low; copy and accessibility.

**M3 · Automatic compaction.** Usage tracking per provider, compaction run, auto trigger, "Compact now".
After it: long chats keep working without losing decisions. Risk: providers report usage differently;
summary quality.

## Ticket list

| Ref | Title |
|---|---|
| 4b6bc398 | M1.1 · Add memory to the document schema and store |
| c669de45 | M1.2 · Add get_memory, remember and forget MCP tools |
| 81577dfa | M1.3 · Inject file memory into the agent prompt |
| b7196f55 | M2.1 · Build the Memory panel |
| b488e1ec | M2.2 · Show when the agent remembers something |
| f31ac00f | M3.1 · Track context usage per chat |
| 4610b749 | M3.2 · Compact a chat into a handoff and notes |
| 4f12e6a3 | M3.3 · Compact automatically and on demand |

## Ticket log

### Concept notes

**Context window and compaction**
- Fundamental: a model only sees a fixed number of tokens per call. Long chats overflow it; compaction replaces old turns with a summary so work continues.
- In this case: after each run the provider reports tokens used; at 75% of the window the app asks the same session for `{handoff, notes}`, then starts a fresh session whose system prompt carries the handoff.
- Trade-off: a summary loses detail. Lasting facts go to memory notes so they survive any number of compactions.
- Check yourself: why compact by resuming the old session instead of sending only the transcript?

**Durable memory vs working memory**
- Fundamental: working memory is the current conversation; durable memory is what outlives it. Mixing them bloats prompts or loses decisions.
- In this case: notes (brand, decisions, conventions) live in the `.spen` file; the handoff lives in the chat record.
- Trade-off: notes in the file travel with it (copy, git) but also reach anyone you share the file with.
- Check yourself: which one moves with the file when you send it to a teammate?

**Prompt injection from data**
- Fundamental: any text that reaches a prompt can try to act as an instruction. Content from files must be framed as data.
- In this case: `memoryBlock` wraps notes in `<file-memory>`, says they are data, strips the closing tag, and caps size; main re-validates notes before building the prompt.
- Trade-off: framing lowers the risk, it does not remove it; the Memory panel lets the user see every note.
- Check yourself: why strip `</file-memory>` from note text?

**Keyed upsert**
- Fundamental: writing with a key replaces the previous value for that key instead of appending.
- In this case: `remember` with `key: "brand.primary"` replaces the old primary colour note; unkeyed notes are dropped first when the cap is hit.
- Trade-off: the agent must pick stable keys; a new key for the same fact still duplicates it.
- Check yourself: what happens when the agent saves "brand.primary" twice with different colours?

**State outside undo history**
- Fundamental: undo replays inverse patches of recorded edits; a change made without recording a patch is not undone.
- In this case: `store.setMemory` swaps the document object without a history entry, so ⌘Z on the canvas leaves notes alone while the file still turns dirty.
- Trade-off: notes cannot be undone with ⌘Z; the panel edit and delete buttons replace it.
- Check yourself: why does undo still restore the canvas after `setMemory` replaced the document object?

### M1 · Durable memory (4b6bc398, c669de45, 81577dfa)
- `src/shared/schema/memory.ts`: note type, lenient `MemorySchema` (clips, drops junk), `capMemory`, `upsertNote` (keyed), `editNote`, `removeNotes`, `memoryBlock` (framed as data, closing tag stripped).
- `DocumentSchema.memory` optional, still version 1. `store.setMemory()` sets state without history.
- MCP `get_memory`, `remember`, `forget` (routed per tab like every document tool). Guide bullet in `core.md`.
- `AgentRunRequest.memory` and `handoff`; `systemPrompt(request)` appends both via `contextNotes()`, re-validated in main.
- Check yourself: why does undo still work after `setMemory` replaced the document object?

### M2 · Memory panel (b7196f55, b488e1ec)
- `MemoryPanel.tsx`: third left tab (⌥3, View › Show Memory), list newest first, inline edit (Enter saves, Esc cancels), delete, add with kind, counter, empty state.
- Agent notes glow for 4s (`.fresh`); chat shows "Remembered: … View".
- Check yourself: which note survives when the cap is hit, a keyed or an unkeyed one?

### M3 · Compaction (f31ac00f, 4610b749, 4f12e6a3)
- `RunResult.contextTokens`: Claude from the last assistant message usage, Codex from `turn.completed`, Gemini from `result.stats`; fallback `estimateTokens` (chars / 4).
- `compact.ts` (prompt + `parseCompaction`), `runner.compactChat` (shares the one-run lock), IPC `agent:compact`.
- AgentPanel: auto compact after a successful run when `shouldCompact`; button "Summarise earlier messages" with usage % tooltip; divider "Earlier messages summarised"; handoff and usage saved in the chat record; notes upserted into the chat's tab.
- Differs from plan: Codex usage may be summed over a turn, so it can compact early. Fix when it shows up.
- Check yourself: after compaction, why is `sessionId` set to null?

## Follow-ups

| Date | Kind | Ticket | Follows | Summary |
|---|---|---|---|---|
| 2026-10-29 | Feature | Hand off design updates to coding agents | M3.2 | Copy handoff button + get_handoff MCP tool |

### Feature · Hand off design updates to coding agents (ba7c6d4c)

Concept, **handoff between agents**
- Fundamental: a new agent knows only what it is told. A handoff gives the goal, what was decided and where to look, not the full history.
- In this case: the note lists asks, result, memory, changed node ids per screen, and how to read them through MCP with `tabId`; `get_handoff` lets an agent pull it itself.
- Trade-off: ids stay small and current but need SuikoPen open; a static export would work offline but go stale.
- Check yourself: what breaks if the coding agent runs while the file is closed in SuikoPen?

- `src/shared/handoff.ts`: `touchedIds` (edit tools and batch ops), `changedIds`, `buildHandoff` (asks, result, memory, changed by screen, removed, MCP how-to).
- Chat `tools` entries now store `ids`; `tab.chatId` points at the tab's latest chat.
- `src/renderer/agent/handoff.ts`: resolves ids to screens; `latestHandoff(tab)` for MCP.
- AgentPanel: "Copy handoff" button (clipboard, live "copied" status). MCP `get_handoff` routed per tab.
- Check yourself: why does the handoff list node ids instead of node JSON?

### Feature · Ship the design-handoff skill (f9101d2b)
- Renamed from `suikopen-implement` to the generic `design-handoff`; the old folder is removed on upgrade, a user's own `design-handoff` skill is never overwritten.
- Listed first in the in-app skill picker with a Built-in badge; inside SuikoPen it writes the handoff instead of code.
- `src/main/agent/skill/design-handoff.md`: steps for a coding agent: get_handoff, design-to-code guide, read screenshots/nodes/tokens, change only listed ids, verify, report.
- `installSkill` writes it to `~/.claude/skills/` and `~/.codex/skills/` on Connect; `refreshSkills` updates it at startup for clients already connected. Gemini skipped (no skill folder).
- Concept, **instructions vs data**: the handoff says *what* changed, the skill says *how* to implement it; shipping the skill with the app keeps it in step with the MCP tools.
- Check yourself: why refresh the skill at startup instead of only on Connect?
