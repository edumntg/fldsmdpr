# FLDSMDPR

**F**ully **L**ocal **D**ispatcher for **S**entry, **M**eetings, **D**ev-tasks, & **P**ull-**R**equests

> One inbox for everything a developer needs to act on — PRs, Linear tickets, Sentry errors, meetings, calendar events — with a Claude Code agent one click away from doing the work for you.

---

## The Problem

A developer's day is fragmented across 5+ tools: GitHub for PR reviews, Linear for tickets, Sentry for errors, a calendar for meetings, and a terminal for actual work. Each tool has its own notification system, its own idea of what's "urgent," and its own tab eating RAM. Things get missed:

- A PR sat waiting for your review for two days because the GitHub notification drowned in noise.
- A production error got assigned to you in Sentry and sat there behind three other tabs.
- A Linear ticket got reassigned to you while you were heads-down.

## The Solution

FLDSMDPR is a **fast, lightweight, local-first desktop app** (macOS & Windows) that pulls all of your actionable items into a single, prioritized inbox — and lets you **act** on them, not just read them:

- **Unified Inbox** — PRs awaiting your review, Linear tickets assigned to you, Sentry errors, meeting action items, upcoming events. One list, deduplicated, prioritized, keyboard-navigable.
- **AI Sources** — Notion pages, Granola meeting notes and (opt-in) Slack are read by the local `claude` CLI through its MCP connectors, so mentions and action items surface without extra tokens. Slack is off by default (Settings → Slack) because its analysis rounds take minutes.
- **Run Agent on This** — every notification carries agent actions: `Fix with agent`, `Review with agent`, `Draft reply`, `Run agent on this task`. One click spawns a Claude Code session (headless or in the built-in terminal) with the full context of that item (PR diff, ticket description, stack trace) already injected.
- **Built-in Terminal** — a real PTY-backed terminal (xterm.js + WebGL) for watching agents work or dropping into a shell without leaving the app.
- **Fully Local** — your tokens live in the OS keychain, your data lives in a local SQLite database, nothing is proxied through a third-party server. The only outbound calls are to the services you connected (GitHub, Linear, Sentry, Google) and to the Anthropic API for agents.

## Design Principles

1. **Fast to open, fast to use.** Cold start < 1.5s, idle RAM < 200 MB. Tauri, not Electron.
2. **Minimal but polished.** Clean two/three-pane layout (sidebar → list → detail), generous whitespace, rounded pill controls, subtle motion. First-class light and dark modes.
3. **Keyboard-first.** Command palette (`⌘K`), j/k navigation, single-key actions on notifications (`e` done, `s` snooze, `p` pin, `o` open…), `?` for the cheat sheet.
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
| Connectors | GitHub (REST), Linear (GraphQL), Sentry, Google Calendar (iCal) / macOS Calendar, Notion, Granola & Slack (opt-in) via `claude` MCP | Polling |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details.

## Install

**macOS** — paste in Terminal (installs or updates, opens the app):

```bash
curl -fsSL https://raw.githubusercontent.com/edumntg/fldsmdpr/main/install.sh | sh
```

Or grab the `.dmg` from the [latest release](https://github.com/edumntg/fldsmdpr/releases/latest), drag it to Applications, open it once and click **Open Anyway** in System Settings → Privacy & Security (the build isn't Apple-notarized).

**Windows** — download and run `FLDSMDPR_<ver>_x64-setup.exe` from the [latest release](https://github.com/edumntg/fldsmdpr/releases/latest).

Installed copies check for updates on launch, download them silently and offer a one-click restart.

**Before first use** you need the [`claude` CLI](https://docs.anthropic.com/claude-code) installed and logged in (agents, Notion/Granola/Slack sources run through it). Optional: [Orca](https://orca.dev) as agent runner. The in-app setup guide walks through GitHub, Linear, Sentry and Calendar tokens.

## Development

```bash
pnpm install       # frontend deps
pnpm tauri dev     # run the app in dev mode
pnpm tauri build   # production bundle (DMG / MSI)
```

Requires Rust (stable), Node 20+, and pnpm.

### Packaging & distribution

Releases are cut by pushing a tag: `git tag v0.2.0 && git push --tags`. The `Release` workflow builds a universal macOS `.dmg`, a Windows NSIS installer, the signed updater artifacts and `latest.json`, and publishes them as a GitHub Release — installed apps pick it up on next launch. The updater private key lives in the `TAURI_SIGNING_PRIVATE_KEY` repo secret (local copy: `~/.tauri/fldsmdpr.key`; a local `pnpm tauri build` needs `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/fldsmdpr.key)"` in the environment). Losing that key means shipped apps can never update again — back it up.

`pnpm tauri build` produces a real installable bundle:
- **macOS:** `src-tauri/target/release/bundle/dmg/FLDSMDPR_<ver>_<arch>.dmg`. The build is **ad-hoc signed** (`signingIdentity: "-"`), which gives the binary a stable identity — so a macOS Keychain "Always Allow" sticks and the secrets prompt stops recurring (unlike `tauri dev`, where each rebuild is a new binary).
- **Windows:** an NSIS installer under `bundle/nsis/`.

For a **notarized, Gatekeeper-clean** macOS build (no "unidentified developer" warning), set an Apple Developer identity: put `APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` in the repo secrets — the `Release` workflow (on `v*` tags) picks them up automatically. Without them it still produces working, ad-hoc-signed bundles.

## Status

🚧 **Alpha — in active daily-driver use.** GitHub, Linear, Sentry, Calendar, and Notion/Granola (via Claude + MCP) connectors are live; agent dispatch works through Orca or the built-in Claude Code terminal.

## Repository Layout

```
fldsmdpr/
├── src/                  # React frontend
│   ├── components/       # Design system + feature components
│   ├── features/         # inbox, terminal, agents, settings, palette
│   └── stores/           # Zustand stores
├── src-tauri/            # Rust core
│   └── src/
│       ├── connectors/   # github, linear, sentry, gcal, maccal, slack, ai_rounds
│       ├── claude_cli.rs # headless claude runner (ask, AI sources)
│       ├── agents/       # Claude Code session management
│       ├── db/           # SQLite schema & queries
│       └── pty/          # terminal backend
└── docs/                 # architecture & design notes
```
