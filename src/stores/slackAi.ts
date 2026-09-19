import { create } from "zustand";
import { slackAiStatus, slackAiSync, slackSetEnabled, slackSetSummaries } from "../lib/ipc";
import { useInbox } from "./inbox";
import { useUi } from "./ui";

interface SlackAiState {
  /** claude CLI found (the analysis path needs it). */
  available: boolean;
  /** Master switch (Settings → Slack). Off hides the section and stops all Slack work. */
  enabled: boolean;
  /** Day/week summaries via claude rounds (minutes each) — off by default. */
  summaries: boolean;
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  daySummary: string;
  weekSummary: string;
  loaded: boolean;
  init: () => Promise<void>;
  sync: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setSummaries: (enabled: boolean) => Promise<void>;
}

// Slack-via-claude rounds are heavy (2-6 min of agentic Slack reading), so
// they run sparsely: the daily 9:00 analysis, then at most once an hour
// (which also covers "app just opened with stale data").
const INTERVAL_MS = 60 * 60_000;
const DAILY_AT = "09:00";
let armed = false;

export const useSlackAi = create<SlackAiState>((set, get) => ({
  available: false,
  enabled: false,
  summaries: false,
  running: false,
  lastSyncAt: null,
  lastError: null,
  daySummary: "",
  weekSummary: "",
  loaded: false,

  init: async () => {
    const s = await slackAiStatus();
    set({
      available: s.available,
      enabled: s.enabled,
      summaries: s.summaries,
      lastSyncAt: s.last_sync_at,
      daySummary: s.day_summary,
      weekSummary: s.week_summary,
      loaded: true,
    });

    if (!armed) {
      armed = true;
      // Minute tick: fire the daily 9:00 analysis, and otherwise re-analyze
      // once the last run is over an hour old (incl. right after opening).
      const tick = () => {
        const st = get();
        if (!st.enabled || !st.summaries || !st.available || st.running) return;
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const stale = !st.lastSyncAt || Date.now() - st.lastSyncAt >= INTERVAL_MS;
        if (hhmm === DAILY_AT || stale) void st.sync();
      };
      tick(); // evaluate immediately on open
      setInterval(tick, 60_000);
    }
  },

  sync: async () => {
    if (get().running || !get().enabled || !get().summaries) return;
    set({ running: true, lastError: null });
    try {
      await slackAiSync();
      await useInbox.getState().reload();
      // Refresh summaries + last-sync from the freshly-stored status.
      const s = await slackAiStatus();
      set({
        lastSyncAt: s.last_sync_at ?? Date.now(),
        daySummary: s.day_summary,
        weekSummary: s.week_summary,
      });
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false });
    }
  },

  setEnabled: async (enabled) => {
    await slackSetEnabled(enabled);
    set({ enabled });
    if (enabled && get().summaries && !get().lastSyncAt) void get().sync();
    // Leaving the Slack section open with Slack off would show an empty shell.
    if (!enabled && useUi.getState().section === "slack") useUi.getState().setSection("inbox");
  },

  setSummaries: async (summaries) => {
    await slackSetSummaries(summaries);
    set({ summaries });
    if (summaries && !get().enabled) await get().setEnabled(true);
    if (summaries && !get().lastSyncAt) void get().sync();
  },
}));
