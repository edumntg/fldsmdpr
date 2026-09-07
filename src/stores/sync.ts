import { create } from "zustand";
import { kvGet, kvSet, runSync } from "../lib/ipc";

interface SyncState {
  lastSyncAt: number | null;
  syncing: boolean;
  /** Daily auto-refresh time, "HH:MM" 24h. Applies while the app stays open. */
  refreshTime: string;
  sync: () => Promise<void>;
  setRefreshTime: (t: string) => void;
  /** Refresh on open + arm the daily scheduler. Called once on app mount. */
  init: () => Promise<void>;
}

const DEFAULT_REFRESH_TIME = "09:00";
let schedulerArmed = false;

export const useSync = create<SyncState>((set, get) => ({
  lastSyncAt: null,
  syncing: false,
  refreshTime: DEFAULT_REFRESH_TIME,

  sync: async () => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      const result = await runSync();
      set({ lastSyncAt: result.synced_at });
    } finally {
      set({ syncing: false });
    }
  },

  setRefreshTime: (refreshTime) => {
    set({ refreshTime });
    void kvSet("refresh_time", refreshTime);
  },

  init: async () => {
    const [savedTime, savedLast] = await Promise.all([kvGet("refresh_time"), kvGet("last_sync_at")]);
    set({
      refreshTime: savedTime ?? DEFAULT_REFRESH_TIME,
      lastSyncAt: savedLast ? Number(savedLast) : null,
    });

    // Always refresh on app open.
    void get().sync();

    // Daily refresh while the app stays open (checked every 30 s).
    if (!schedulerArmed) {
      schedulerArmed = true;
      setInterval(async () => {
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        if (hhmm !== get().refreshTime) return;
        const today = now.toDateString();
        const lastAutoDay = await kvGet("last_auto_sync_day");
        if (lastAutoDay === today) return;
        await kvSet("last_auto_sync_day", today);
        void get().sync();
      }, 30_000);
    }
  },
}));
