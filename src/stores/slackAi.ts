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

// Slack-via-claude rounds are heavy (2-6 min of agentic Slack reading), so run
// them sparsely — analyze-on-open plus every 15 min while focused.
const INTERVAL_MS = 15 * 60_000;
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

    if (s.enabled) void get().sync(); // analyze on open

    if (!armed) {
      armed = true;
      setInterval(() => {
        const st = get();
        if (st.enabled && !st.running && document.hasFocus()) void st.sync();
      }, INTERVAL_MS);
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
