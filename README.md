# FLDSMDPR

**F**ully **L**ocal **D**ispatcher for **S**lack, **M**essages, **D**ev-tasks, & **P**ull-**R**equests

> One inbox for everything a developer needs to act on — PRs, Slack mentions, Linear tickets, calendar events — with a Claude Code agent one click away from doing the work for you.

---

## The Problem

A developer's day is fragmented across 5+ tools: GitHub for PR reviews, Slack for conversations, Linear for tickets, a calendar for meetings, and a terminal for actual work. Each tool has its own notification system, its own idea of what's "urgent," and its own tab eating RAM. Things get missed:

- A PR sat waiting for your review for two days because the GitHub notification drowned in noise.
- A Slack thread decided something that affects your project — nobody @-mentioned you, so you never saw it.
- A Linear ticket got reassigned to you while you were heads-down.

## The Solution

FLDSMDPR is a **fast, lightweight, local-first desktop app** (macOS & Windows) that pulls all of your actionable items into a single, prioritized inbox — and lets you **act** on them, not just read them:

- **Unified Inbox** — PRs awaiting your review, Slack mentions, Linear tickets assigned to you, upcoming meetings. One list, deduplicated, prioritized, keyboard-navigable.
- **AI Relevance Detection** — beyond literal @-mentions: a local triage pipeline uses Claude (Haiku for cheap/fast classification) to detect messages that *implicitly* concern you — your team's channel discussing your service, someone describing a bug in code you own, a thread where your name appears without an @. Those become notifications too.
- **Run Agent on This** — every notification carries agent actions: `Fix with agent`, `Review with agent`, `Draft reply`, `Run agent on this task`. One click spawns a Claude Code session (headless or in the built-in terminal) with the full context of that item (PR diff, ticket description, thread history) already injected.
- **Built-in Terminal** — a real PTY-backed terminal (xterm.js + WebGL) for watching agents work or dropping into a shell without leaving the app.
- **Fully Local** — your tokens live in the OS keychain, your data lives in a local SQLite database, nothing is proxied through a third-party server. The only outbound calls are to the services you connected (GitHub, Slack, Linear, Google) and to the Anthropic API for triage/agents.

## Design Principles

1. **Fast to open, fast to use.** Cold start < 1.5s, idle RAM < 200 MB. Tauri, not Electron.
2. **Minimal but polished.** Clean two/three-pane layout (sidebar → list → detail), generous whitespace, rounded pill controls, subtle motion. First-class light and dark modes.
3. **Keyboard-first.** Command palette (`⌘K`), j/k navigation, single-key actions on notifications.
4. **Act, don't just aggregate.** Every item answers "what can I *do* about this right now?" — and the best answer is usually "let an agent do it."
5. **Local-first & private.** No middleman servers. Deleting the app deletes your data.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** (Rust) | ~10 MB binaries, native webview, low RAM, fast startup, macOS + Windows |
| UI | **React 19 + TypeScript + Vite** | Ecosystem velocity, familiar |
| Styling | **Tailwind CSS 4 + Radix primitives** | Design-token driven light/dark theming |
| State/Data | **Zustand + TanStack Query** | Simple local state + cache/sync of connector data |
| Storage | **SQLite** (rusqlite in the Rust core) | Local-first inbox, offline reads, full-text search |
| Secrets | **OS keychain** (`keyring` crate) | Tokens never touch disk in plaintext |
| Terminal | **xterm.js (WebGL) + portable-pty** | Real PTY, fast rendering, splits |
| Agents | **Claude Code** (Agent SDK / headless CLI) | `Run agent on this` sessions with injected context |
| AI Triage | **Claude Haiku 4.5** (fast/cheap) with Sonnet escalation | Implicit-mention relevance classification |
| Connectors | GitHub (GraphQL), Slack (Events/Socket Mode), Linear (GraphQL), Google Calendar | Polling + push where available |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details.

## Development

```bash
pnpm install       # frontend deps
pnpm tauri dev     # run the app in dev mode
pnpm tauri build   # production bundle (DMG / MSI)
```

Requires Rust (stable), Node 20+, and pnpm.

### Packaging & distribution

`pnpm tauri build` produces a real installable bundle:
- **macOS:** `src-tauri/target/release/bundle/dmg/FLDSMDPR_<ver>_<arch>.dmg`. The build is **ad-hoc signed** (`signingIdentity: "-"`), which gives the binary a stable identity — so a macOS Keychain "Always Allow" sticks and the secrets prompt stops recurring (unlike `tauri dev`, where each rebuild is a new binary).
- **Windows:** an NSIS installer under `bundle/nsis/`.

For a **notarized, Gatekeeper-clean** macOS build (no "unidentified developer" warning), set an Apple Developer identity: put `APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` in the repo secrets — the `Release` workflow (on `v*` tags) picks them up automatically. Without them it still produces working, ad-hoc-signed bundles.

## Status

🚧 **Alpha — in active daily-driver use.** GitHub, Linear, Slack (via Claude + MCP), and Calendar connectors are live; agent dispatch works through Orca or the built-in Claude Code terminal.

## Repository Layout

```
fldsmdpr/
├── src/                  # React frontend
│   ├── components/       # Design system + feature components
│   ├── features/         # inbox, terminal, agents, settings, palette
│   └── stores/           # Zustand stores
├── src-tauri/            # Rust core
│   └── src/
│       ├── connectors/   # github, slack, linear, gcal
│       ├── triage/       # AI relevance pipeline
│       ├── agents/       # Claude Code session management
│       ├── db/           # SQLite schema & queries
│       └── pty/          # terminal backend
└── docs/                 # architecture & design notes
```
