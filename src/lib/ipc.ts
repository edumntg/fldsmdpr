/**
 * Typed IPC layer over Tauri commands.
 * Falls back to localStorage when running in a plain browser (vite dev
 * without the Tauri shell), so the UI stays previewable.
 */

const inTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function kvGet(key: string): Promise<string | null> {
  if (!inTauri) return localStorage.getItem(`kv:${key}`);
  return invoke<string | null>("kv_get", { key });
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (!inTauri) {
    localStorage.setItem(`kv:${key}`, value);
    return;
  }
  return invoke("kv_set", { key, value });
}

export interface AppInfo {
  version: string;
  db_path: string;
  notification_count: number;
}

export async function appInfo(): Promise<AppInfo | null> {
  if (!inTauri) return null;
  return invoke<AppInfo>("app_info");
}

// ---- providers / connections ----

export interface ProviderStatus {
  id: string;
  connected: boolean;
  account: string | null;
}

export async function providerStatus(): Promise<ProviderStatus[]> {
  if (!inTauri) {
    // browser preview: read from localStorage mirror
    return ["github", "slack", "linear", "gcal", "sentry"].map((id) => ({
      id,
      connected: localStorage.getItem(`mock-conn:${id}`) !== null,
      account: localStorage.getItem(`mock-conn:${id}`),
    }));
  }
  return invoke<ProviderStatus[]>("provider_status");
}

export async function providerConnect(provider: string, token: string): Promise<string> {
  if (!inTauri) {
    if (!token.trim()) throw new Error("Token is empty");
    localStorage.setItem(`mock-conn:${provider}`, "preview-account");
    return "preview-account";
  }
  return invoke<string>("provider_connect", { provider, token });
}

export async function providerDisconnect(provider: string): Promise<void> {
  if (!inTauri) {
    localStorage.removeItem(`mock-conn:${provider}`);
    return;
  }
  return invoke("provider_disconnect", { provider });
}

// ---- sync ----

export interface SyncResult {
  synced_at: number;
  providers: string[];
  new_count: number;
  errors: string[];
}

export async function runSync(): Promise<SyncResult> {
  if (!inTauri) return { synced_at: Date.now(), providers: [], new_count: 0, errors: [] };
  return invoke<SyncResult>("run_sync");
}

// ---- slack (session-token auth, no app) ----

export interface SlackChannel {
  id: string;
  name: string;
}

export async function slackConnect(xoxc: string, xoxd: string): Promise<string> {
  if (!inTauri) {
    if (!xoxc.trim()) throw new Error("Paste your xoxc- token");
    localStorage.setItem("mock-conn:slack", "preview-account");
    return "preview-account";
  }
  return invoke<string>("slack_connect", { xoxc, xoxd });
}

export async function slackListChannels(): Promise<SlackChannel[]> {
  if (!inTauri)
    return [
      { id: "C1", name: "#payments" },
      { id: "C2", name: "#eng-platform" },
      { id: "C3", name: "#general" },
    ];
  return invoke<SlackChannel[]>("slack_list_channels");
}

export interface SlackAiStatus {
  available: boolean;
  enabled: boolean;
  about_me: string;
  last_sync_at: number | null;
  day_summary: string;
  week_summary: string;
}

export async function slackAiStatus(): Promise<SlackAiStatus> {
  if (!inTauri)
    return {
      available: true,
      enabled: true, // browser preview: show the overview with sample data
      about_me: "",
      last_sync_at: Date.now() - 8 * 60_000,
      day_summary: JSON.stringify([
        { text: "The payout webhook started returning 500s after the 10am deploy; platform team asked for an owner.", channel: "#payments", actionable: true },
        { text: "Migration plan for the notifications table approved — staging run scheduled for tomorrow.", channel: "#eng-platform", actionable: false },
        { text: "A teammate asked whether the admin pipeline is fixed.", channel: "DM", actionable: true },
      ]),
      week_summary: JSON.stringify([
        { text: "Cycle 14 kicked off with rate-limit hardening as the top priority.", channel: "#eng-platform", actionable: false },
        { text: "Two incidents traced to expired GitHub tokens; a circuit breaker was proposed (PLA-341).", channel: "#incidents", actionable: true },
      ]),
    };
  return invoke<SlackAiStatus>("slack_ai_status");
}

export async function slackAiCheck(): Promise<boolean> {
  if (!inTauri) return true;
  return invoke<boolean>("slack_ai_check");
}

export async function slackSetAi(enabled: boolean, aboutMe: string): Promise<void> {
  if (!inTauri) return;
  return invoke("slack_set_ai", { enabled, aboutMe });
}

export async function slackAiSync(): Promise<number> {
  if (!inTauri) return 0;
  return invoke<number>("slack_ai_sync");
}

export async function slackResolveChannel(idOrUrl: string): Promise<SlackChannel> {
  if (!inTauri) {
    const id = (idOrUrl.match(/[CGD][A-Z0-9]{6,}/) ?? ["C0PREVIEW"])[0];
    return { id, name: `#${id.toLowerCase()}` };
  }
  return invoke<SlackChannel>("slack_resolve_channel", { idOrUrl });
}

export async function slackGetChannels(): Promise<SlackChannel[]> {
  if (!inTauri) return [];
  return invoke<SlackChannel[]>("slack_get_channels");
}

export async function slackSetChannels(channels: SlackChannel[]): Promise<void> {
  if (!inTauri) return;
  return invoke("slack_set_channels", { channels });
}

// ---- GitHub PR detail (files changed, diffs) ----

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface PrDetail {
  body: string;
  author: string;
  base: string;
  head: string;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  files: PrFile[];
  truncated: boolean;
}

export async function githubPrDetail(repo: string, number: number): Promise<PrDetail> {
  if (!inTauri) {
    return {
      body: "Fixes the retry storm by adding jittered backoff to the webhook worker.",
      author: "a-teammate",
      base: "main",
      head: "fix/retry-backoff",
      additions: 120,
      deletions: 43,
      changed_files: 2,
      commits: 3,
      truncated: false,
      files: [
        {
          filename: "src/worker/retry.ts",
          status: "modified",
          additions: 98,
          deletions: 30,
          patch: "@@ -10,7 +10,12 @@\n-const delay = 1000;\n+const delay = base * 2 ** attempt + jitter();",
        },
        { filename: "src/worker/retry.test.ts", status: "modified", additions: 22, deletions: 13, patch: null },
      ],
    };
  }
  return invoke<PrDetail>("github_pr_detail", { repo, number });
}

// ---- AI sources (Notion / Granola via claude rounds) ----

export interface AiSourceStatus {
  available: boolean;
  enabled: boolean;
  last_sync_at: number | null;
  last_error: string | null;
}

export async function aiSourceStatus(source: string): Promise<AiSourceStatus> {
  if (!inTauri) return { available: true, enabled: false, last_sync_at: null, last_error: null };
  return invoke<AiSourceStatus>("ai_source_status", { source });
}

export async function aiSourceSet(source: string, enabled: boolean): Promise<void> {
  if (!inTauri) return;
  return invoke("ai_source_set", { source, enabled });
}

export async function aiSourceSync(source: string): Promise<number> {
  if (!inTauri) return 0;
  return invoke<number>("ai_source_sync", { source });
}

export async function morningBriefing(): Promise<void> {
  if (!inTauri) return;
  return invoke("morning_briefing");
}

// ---- macOS Calendar ----

export interface MacCalConfig {
  available: boolean;
  enabled: boolean;
  calendars: string[];
}

export async function maccalConfig(): Promise<MacCalConfig> {
  if (!inTauri) return { available: true, enabled: false, calendars: [] };
  return invoke<MacCalConfig>("maccal_config");
}

export async function maccalListCalendars(): Promise<string[]> {
  if (!inTauri) return ["eduardo@company.com", "Personal"];
  return invoke<string[]>("maccal_list_calendars");
}

export async function maccalSetConfig(enabled: boolean, calendars: string[]): Promise<void> {
  if (!inTauri) return;
  return invoke("maccal_set_config", { enabled, calendars });
}

// ---- agents ----

export async function orcaStatus(): Promise<{ installed: boolean }> {
  if (!inTauri) return { installed: true }; // browser preview pretends it's there
  return invoke<{ installed: boolean }>("orca_status");
}

export interface OrcaRepo {
  id: string;
  name: string;
  path: string;
  remote: string | null;
}

export async function orcaRepos(): Promise<OrcaRepo[]> {
  if (!inTauri)
    return [
      { id: "r1", name: "core-api", path: "/Users/you/dev/core-api", remote: "github.com/acme-corp/core-api" },
      { id: "r2", name: "aurora-api", path: "/Users/you/dev/aurora-api", remote: "github.com/acme-corp/aurora-api" },
    ];
  return invoke<OrcaRepo[]>("orca_repos");
}

export async function launchOrca(args: {
  name: string;
  repo: string;
  prompt: string;
  comment?: string;
  repoId?: string;
}): Promise<{ worktree: string }> {
  if (!inTauri) {
    await new Promise((r) => setTimeout(r, 600));
    return { worktree: args.name };
  }
  return invoke<{ worktree: string }>("launch_orca", args);
}

// ---- inbox ----

import type { AppNotification, NotificationState } from "./types";

export async function listNotifications(): Promise<AppNotification[] | null> {
  if (!inTauri) return null; // browser preview falls back to mock data
  return invoke<AppNotification[]>("list_notifications");
}

export async function setNotificationState(id: string, state: NotificationState): Promise<void> {
  if (!inTauri) return;
  return invoke("set_notification_state", { id, state });
}

export async function snoozeNotification(id: string, until: number): Promise<void> {
  if (!inTauri) return;
  return invoke("snooze_notification", { id, until });
}

/** Full-text search across everything ever received, including archived/done. */
export async function searchNotifications(query: string): Promise<AppNotification[]> {
  if (!inTauri) {
    const q = query.toLowerCase();
    const { mockNotifications } = await import("../features/inbox/mockData");
    return mockNotifications.filter(
      (n) => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q),
    );
  }
  return invoke<AppNotification[]>("search_notifications", { query });
}

// ---- agent sessions (history) ----

export interface AgentSession {
  id: string;
  notification_id: string | null;
  mode: string; // orca | claude
  status: string;
  title: string;
  source: string;
  label: string;
  detail: string | null;
  started_at: number;
  ended_at: number | null;
}

export async function agentSessionUpsert(s: AgentSession): Promise<void> {
  if (!inTauri) return;
  return invoke("agent_session_upsert", { s });
}

export async function agentSessionsList(): Promise<AgentSession[]> {
  if (!inTauri)
    return [
      { id: "d1", notification_id: "n4", mode: "claude", status: "done", title: "PLA-341: Rate-limit retry storm", source: "linear", label: "Run agent on this task", detail: "Built-in terminal · core-api", started_at: Date.now() - 3600_000, ended_at: Date.now() - 3000_000 },
    ];
  return invoke<AgentSession[]>("agent_sessions_list");
}
