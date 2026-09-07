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
  loaded: boolean;
  init: () => Promise<void>;
  sync: () => Promise<void>;
  setConfig: (enabled: boolean, aboutMe: string) => Promise<void>;
}

// Slack-via-claude is slow (~1 min/round), so it runs on its own slow cadence.
const INTERVAL_MS = 5 * 60_000;
let armed = false;

export const useSlackAi = create<SlackAiState>((set, get) => ({
  available: false,
  enabled: false,
  aboutMe: "",
  running: false,
  lastSyncAt: null,
  lastError: null,
  loaded: false,

  init: async () => {
    const s = await slackAiStatus();
    set({
      available: s.available,
      enabled: s.enabled,
      aboutMe: s.about_me,
      lastSyncAt: s.last_sync_at,
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
      set({ lastSyncAt: Date.now() });
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
