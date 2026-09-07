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
    return ["github", "slack", "linear", "gcal"].map((id) => ({
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

export async function launchOrca(args: {
  name: string;
  repo: string;
  prompt: string;
  comment?: string;
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
