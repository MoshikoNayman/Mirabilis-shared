# Mirabilis AI — Changelog

Versioning follows Junos-style tags.

## [26.3R1-S3] — 2026-04-10

### UI Polish & Styling Session

- **4-scheme palette system** — Mirabilis (green), Dusk (indigo/violet), Ember (warm amber), Summit (Apple blue). Replaces hardcoded accent values with CSS custom properties; Tailwind `accent`/`accentSoft` tokens now resolve from CSS vars, so all components update automatically on scheme switch.
- **Palette picker** — 4-button pill grid in the Appearance panel; no-flash restore via inline script in `layout.js`.
- **Syntax highlighting** — `react-syntax-highlighter` (Prism) with a per-scheme 13-var token theme covering comment, keyword, tag, attr, string, number, fn, and lang tokens. Line numbers included.
- **Streaming phase labels** — typing indicator cycles through Processing → Thinking → Generating → Loading model → Still working… phases during long inference.
- **Role labels** — "user" → "You", "assistant" → "AI".
- **Auto-scroll overhaul** — programmatic vs. user scroll guard via `isProgrammaticScrollRef`; ref checked inside `requestAnimationFrame` (not just at effect entry) to close the RAF-queue race. `lastScrollTopRef` synced after every programmatic scroll so direction detection stays accurate.
- **"New messages ↓" pill** — centered at bottom of chat, themed to current palette accent color.
- **Dusk replaces Flower** — Flower (teal) was too close in hue to Mirabilis (green). Dusk uses deep indigo (`#5046e4`) with a deep-space code block. LocalStorage validation updated; old `flower` value gracefully falls back to Mirabilis.
- **Bug fix** — duplicate stray `</button>` JSX in palette picker (caused by a prior edit) removed.
- **Bug fix** — `layout.js` pre-hydration scheme script now validates against whitelist before setting attribute, preventing flash if an obsolete scheme name is in localStorage.

## [26.3R1] — 2026-04-08

### Chat Sidebar Enhancements

- **Chat search** — live filter input above the chat list; always visible, scrolls with header not with list.
- **Chat rename** — inline rename input in each chat item's three-dot menu.
- **Chat export** — download any conversation as a Markdown `.md` file from the three-dot menu.
- **Pin / unpin chats** — star icon in the three-dot menu pins chats to the top of the list; persisted in `localStorage`.
- **Sorted chat list** — pinned chats always appear above unpinned ones.
- Keyboard shortcut **Ctrl+K / ⌘K** creates a new chat from anywhere.
- Creating a new chat clears any active search query so the new chat is immediately visible.
- Chat three-dot menus now close on outside click or Escape.

### Generation Parameters Panel

- **Temperature slider** (0–2.0) and **Max tokens** number input added to the model dropdown.
- Settings persist across sessions via `localStorage`.
- Both parameters are sent end-to-end through the stream request to all providers:
  - Ollama: `options.temperature` + `options.num_predict`
  - OpenAI-compatible / KoboldCpp: `temperature` + `max_tokens`
- Resetting temperature to default (null) removes the field from the request, letting the provider use its own default.

### Backend Reliability

- **Write-lock serialisation** in `chatStore.js` — all write operations are queued through a promise mutex, eliminating concurrent read-modify-write data loss under fast streaming.
- **Read cache** in `chatStore.js` — invalidated on every write; eliminates redundant filesystem reads within the same request cycle.
- **Epoch guard** — `saveChat` snapshots the store epoch before entering the queue; if `clearChats` ran while the save was waiting, the write is silently dropped, preventing cleared chats from being resurrected.
- **Message rollback** — if an assistant stream produces no output (provider not running), the user message is removed from the chat and `updatedAt` is restored, keeping the store clean.
- **Chat rename API** — `PATCH /api/chats/:chatId` now accepts `{ title }` to rename a chat (truncated to 80 chars).

### Toolbar Chip Re-order & OpenClaw Redesign

- Toolbar chip order now ends with **Control → MCP → OpenClaw** for logical grouping.
- Removed the standalone "i" info button next to OpenClaw.
- OpenClaw chip now shows a **CSS hover tooltip** describing the profile — no click, no state, no extra button.

### Send Button

- Send button height reduced so it no longer touches the Voice chip; both elements remain aligned with the textarea height.

### Removed

- Deleted the ICQ theme (`ICQApp.jsx` and the `/icq` route) — no longer part of the product.

---

## [26.2R1] — 2026-04-06

### Launcher and Naming Cleanup

- Replaced fragmented startup scripts with a unified launcher:
  - `install.sh`
  - `run.sh`
- Added canonical provider names across launcher, backend, and UI:
  - `ollama`
  - `openai-compatible`
  - `koboldcpp`
- Removed legacy alias behavior from `run.sh` so provider naming is consistent.

### Provider Runtime Reliability

- `install.sh` now installs and validates local runtime binaries:
  - `llama-server`
  - `koboldcpp`
- KoboldCpp installer now fetches the latest release asset from GitHub and validates binary format.
- `run.sh` now supports explicit provider modes:
  - `./run.sh ollama`
  - `./run.sh openai-compatible`
  - `./run.sh koboldcpp`
- `./run.sh` (UI mode) starts all available local providers so switching in UI does not require relaunching.

### CPU Core Utilization

- Added automatic thread detection using all logical CPU cores by default for:
  - `llama-server`
  - `koboldcpp`
- Added override env var:
  - `MIRABILIS_THREADS=<n>`
- Applied thread flags:
  - `llama-server`: `--threads`, `--threads-batch`, `--threads-http`
  - `koboldcpp`: `--threads`, `--blasthreads`

### Session Management

- Added `./run.sh stop` to cleanly terminate all Mirabilis/provider processes.

### Uncensored Mode Hardening

- Backend uncensored directive tightened to reduce refusals/moralizing on profanity-heavy prompts.
- Added guard to avoid policy/instruction leakage in uncensored responses.

### Config and Provider Defaults

- OpenAI-compatible default base URL updated to `http://127.0.0.1:8000/v1`.
- Provider-health fallback behavior improved so unreachable external providers can fall back to Ollama when available.

### Docs Refresh

- README rewritten to match current scripts and canonical provider modes.
- Removed stale references to deleted scripts (`run-local.sh`, `mirabilis-start.sh`, etc.).


