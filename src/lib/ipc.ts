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
