# suikopen

A local-first design editor with a built-in AI design agent. Documents are plain `.spen` JSON files on your disk, and the agent works with the plan you already pay for: Claude Code, Codex (ChatGPT) or Gemini CLI.

- Canvas editor: frames, rectangles, ellipses, text, auto layout, components, variables and themes
- Layers and Properties panels, snapping, undo for every edit
- Agent panel: chat with Claude Code, Codex or Gemini CLI, attach images, PDFs and text, add skills from `~/.agents/skills`
- MCP server, so agents in your terminal or IDE can read and edit the open document
- Imports pen.dev `.pen` files

## Requirements

- macOS (Apple silicon or Intel)
- Node.js 22 or later
- At least one agent CLI, signed in with your plan:

| Agent | Install | Sign in |
| --- | --- | --- |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude auth login` |
| Codex | `npm install -g @openai/codex` | `codex login` |
| Gemini CLI | `npm install -g @google/gemini-cli` | `gemini` |

## Install and run

```sh
git clone https://github.com/fadlihdytullah/suikopen.git
cd suikopen
npm install
npm run dev
```

Build a production bundle with `npm run build`, then start it with `npm run preview`.

To get a standalone app, run `npm run dist`. It writes `dist/mac-arm64/SuikoPen.app`; copy it to `/Applications`. The app is ad-hoc signed, so the first time, right-click it and choose Open. It uses the `claude`, `codex` and `gemini` CLIs installed on your Mac.

## Set up the agent

1. Open **Settings** with `⌘,` and choose **Agents**.
2. Check that your agent shows **Connected**. If it says **Sign in needed**, choose **Sign in** and finish in Terminal.
3. Choose **Test** to send a short test message.
4. Open the **Agent** tab in the left panel (`⌥2`), pick a model, and describe a screen or a change.

suikopen uses each agent's own sign-in. It never asks for or stores API keys.

## Connect agents in your terminal or IDE (MCP)

While suikopen is open, it runs an MCP server at `http://127.0.0.1:29980/mcp`.

The quickest way: **Settings › Integrations › Connect** for Claude Code, Codex or Gemini CLI. suikopen adds itself to that agent's config file and keeps a `.suikopen-backup` copy first. Restart the agent afterwards.

To set it up by hand:

```sh
# Claude Code
claude mcp add --transport http suikopen http://127.0.0.1:29980/mcp
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.suikopen]
url = "http://127.0.0.1:29980/mcp"
```

```json
// Gemini CLI: ~/.gemini/settings.json
{ "mcpServers": { "suikopen": { "httpUrl": "http://127.0.0.1:29980/mcp" } } }
```

Check the connection with `/mcp` in Claude Code, then ask something like:

> Use suikopen to describe my current document and add a pricing section.

Edits made through MCP show up live on the canvas and can be undone with `⌘Z`.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Move, Frame, Rectangle, Ellipse, Text, Hand | `V` `F` `R` `O` `T` `H` |
| Edit text | Double-click or `Enter` |
| Duplicate | `⌘D` |
| Group, Frame selection, Ungroup | `⌘G`, `⌥⌘G`, `⇧⌘G` |
| Bring forward / send backward | `⌘]` / `⌘[` |
| Zoom to fit, to selection, to 100% | `⇧1`, `⇧2`, `⇧0` |
| Layers, Agent, toggle panels | `⌥1`, `⌥2`, `⌘\` |
| Settings | `⌘,` |

## Development

```sh
npm test           # vitest
npm run typecheck  # tsc --noEmit
```
