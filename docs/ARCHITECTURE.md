# FLDSMDPR — Architecture

**Status:** Draft · companion to [PRD.md](PRD.md)

## 1. Stack Decision

**Chosen: Tauri 2 (Rust core) + React 19/TypeScript/Vite frontend.**

| Option | Startup | Idle RAM | Binary | Notes |
|---|---|---|---|---|
| **Tauri 2** ✅ | ~0.5–1 s | 80–200 MB | ~10 MB | System webview (WKWebView/WebView2); Rust core ideal for sync workers, PTY, SQLite |
| Electron | 2–4 s | 300–500 MB+ | 80–150 MB+ | Ships Chromium; violates G3 (fast/light). Orca uses it, we don't need its embedded-Chromium features |
| Native (SwiftUI + WinUI) | best | best | small | Two codebases; too slow to build solo |
| Flutter desktop | good | medium | ~40 MB | Weaker web-tech ecosystem for terminal (xterm.js) and markdown/diff rendering |

Frontend alternatives considered: SolidJS (lighter, smaller ecosystem), Svelte 5 (great, but React chosen for component ecosystem velocity — Radix, diff viewers, xterm bindings). The webview dominates RAM either way; framework choice is secondary.

## 2. Process Model

```
┌──────────────────────────── Tauri App ────────────────────────────┐
│                                                                   │
│  WebView (React UI)                                               │
│    inbox · detail · terminal (xterm.js) · palette · settings      │
│         ▲                                                         │
│         │ typed IPC (commands + events)                           │
│         ▼                                                         │
│  Rust Core (single process, async tokio runtime)                  │
│    ├── connectors/   github · slack · linear · gcal (sync tasks)  │
│    ├── triage/       heuristics → Haiku 4.5 → Sonnet escalation   │
│    ├── notify/       normalization, priority, dedupe, OS notif    │
│    ├── agents/       claude sessions (headless + PTY), worktrees  │
│    ├── pty/          portable-pty ↔ xterm.js bridge               │
│    ├── db/           rusqlite (WAL) + FTS5 + migrations           │
│    └── secrets/      keyring (macOS Keychain / Windows CredMgr)   │
│                                                                   │
└───────────────┬─────────────────────────────┬─────────────────────┘
                │                             │
   External APIs (direct, no proxy)      Local processes
   GitHub · Slack · Linear · Google      `claude` CLI / Agent SDK,
   · Anthropic (triage)                  user shells (PTY)
```

- **One Rust process** hosts all background work as tokio tasks — no sidecar daemons (keeps RAM low, simplifies packaging).
- **IPC:** Tauri commands for request/response; Tauri events for push (new notification, PTY output chunks, agent status). Generated TS types (`specta`/`tauri-specta`) keep the boundary typed.
- **PTY streaming:** binary event channel, batched at ~8 ms frames to keep terminal throughput smooth in the webview.

## 3. Data Model (SQLite)

```sql
notifications(id, source, type, title, snippet, url, created_at,
              priority REAL, state, relevance_kind, relevance_score,
              relevance_reason, context_json, group_key)
sources(id, kind, account_label, scopes, last_sync_at, cursor_json)
profile(id, json)              -- "About me": teams, services, repos, aliases
triage_feedback(id, notification_id, verdict, created_at)  -- few-shot store
agent_sessions(id, notification_id, mode, repo_path, worktree_path,
               status, started_at, ended_at, log_path)
repos(id, remote_url, local_path, default_branch)
kv(key, value)                 -- settings, snooze schedules, token budgets
+ FTS5 virtual table over notifications(title, snippet)
```

`group_key` powers cross-source dedupe (e.g., PR URL referenced by a Linear ticket and a Slack thread collapses into one grouped inbox item).

## 4. Sync Strategy

- Each connector runs an independent task with **incremental cursors** and **adaptive polling** (fast when app focused, slow when idle/on battery; jittered backoff on rate limits).
- Push where cheap: Slack Socket Mode; others poll (GitHub 30–60 s GraphQL batched, Linear 60 s, Calendar 5 min + local alarm for "meeting soon").
- All writes go through `notify/` normalization → dedupe → priority → SQLite → UI event + optional OS notification. UI reads only from SQLite (offline-safe).

## 5. AI Triage Pipeline

```
message → [0-cost filters] explicit mention? participant? keyword/alias hit?
        → yes: notify (explicit)
        → maybe: enqueue → batch → Haiku 4.5 classify {relevant, score, reason}
              score 0.4–0.7 → Sonnet w/ fuller thread context
        → notify (implicit, reason surfaced) or drop
feedback("Not relevant") → stored → appended as few-shot counterexamples
```

Budget enforcement: daily token cap in `kv`, meter in settings; queue pauses (never drops silently) when cap is hit.

## 6. Agent Execution

- **Headless:** spawn `claude -p "<built prompt>" --output-format stream-json` (or Agent SDK) with `cwd` = mapped repo (optionally a fresh `git worktree`). Stream progress into `agent_sessions`; completion/needs-input become inbox notifications.
- **Interactive:** open a PTY tab running `claude`, injecting the built context as the initial prompt; user steers directly.
- **Context builders** produce a structured prompt per type: PR (branch, diff, comments, CI), ticket (description, links, repo hint), Slack (transcript, extracted ask). Prompt is previewable before launch (safety).
- Auth: agent runs reuse the user's local `claude` login; the app stores no Anthropic credentials for agents.

## 7. Security & Privacy

- OAuth via localhost loopback / device flow; tokens only in OS keychain; least-privilege scopes per connector.
- No proxy/backend server — the app talks directly to each API. Uninstall = data gone (SQLite + logs in app-data dir).
- Message content sent to Anthropic **only** for opted-in channels, only for triage candidates that pass heuristics; nothing is used for anything else.
- Agent prompt preview + explicit repo-mapping confirmation before any agent touches a repo.

## 8. Theming & Design Tokens

- Tailwind 4 CSS variables: `--bg-canvas`, `--bg-elevated`, `--fg-*`, `--accent`, `--radius-*`, semantic per-source colors (PR purple, Slack green, Linear indigo, Calendar amber, Agent cyan).
- `data-theme="light|dark"` on root; follows OS by default. All components consume tokens only — no raw hex in components.
- Reference aesthetic: soft-gray canvas, elevated white/dark cards, pill controls, 12–16 px radii, Lucide icons, Inter + JetBrains Mono, 120–180 ms ease-out motion.
