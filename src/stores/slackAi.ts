import { create } from "zustand";
import { slackAiStatus, slackAiSync, slackSetAi } from "../lib/ipc";
import { useInbox } from "./inbox";

interface SlackAiState {
  available: boolean;
  enabled: boolean;
  aboutMe: string;
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  daySummary: string;
  weekSummary: string;
  loaded: boolean;
  init: () => Promise<void>;
  sync: () => Promise<void>;
  setConfig: (enabled: boolean, aboutMe: string) => Promise<void>;
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
  aboutMe: "",
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
      aboutMe: s.about_me,
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
        if (!st.enabled || st.running) return;
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
    if (get().running || !get().enabled) return;
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

  setConfig: async (enabled, aboutMe) => {
    await slackSetAi(enabled, aboutMe);
    set({ enabled, aboutMe });
    if (enabled && !get().lastSyncAt) void get().sync();
  },
}));
