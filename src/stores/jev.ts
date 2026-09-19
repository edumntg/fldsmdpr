import { create } from "zustand";
import { jevStatus, jevConnect, jevDisconnect, jevSetEnabled, jevRun } from "../lib/ipc";
import { useInbox } from "./inbox";

interface JevState {
  connected: boolean;
  enabled: boolean;
  lastRun: number | null;
  judged: number;
  running: boolean;
  error: string | null;
  loaded: boolean;
  init: () => Promise<void>;
  connect: (key: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  run: () => Promise<void>;
}

/** Jev (TypeSafe decision model via OpenRouter): connection + triage status. */
export const useJev = create<JevState>((set, get) => ({
  connected: false,
  enabled: true,
  lastRun: null,
  judged: 0,
  running: false,
  error: null,
  loaded: false,

  init: async () => {
    const s = await jevStatus();
    set({ connected: s.connected, enabled: s.enabled, lastRun: s.last_run, judged: s.judged, loaded: true });
  },

  connect: async (key) => {
    await jevConnect(key);
    await get().init();
    void get().run();
  },

  disconnect: async () => {
    await jevDisconnect();
    set({ connected: false });
  },

  setEnabled: async (enabled) => {
    await jevSetEnabled(enabled);
    set({ enabled });
  },

  run: async () => {
    if (get().running) return;
    set({ running: true, error: null });
    try {
      await jevRun();
      await useInbox.getState().reload();
      await get().init();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false });
    }
  },
}));

/** Jev active: worth spending a call on (agent outcome, etc.). */
export const jevActive = () => {
  const s = useJev.getState();
  return s.connected && s.enabled;
};
