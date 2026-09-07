import { create } from "zustand";
import { aiSourceStatus, aiSourceSet, aiSourceSync } from "../lib/ipc";
import { useInbox } from "./inbox";

export type AiSource = "notion" | "granola";

interface SourceState {
  available: boolean;
  enabled: boolean;
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
}

interface AiSourcesState {
  sources: Record<AiSource, SourceState>;
  loaded: boolean;
  init: () => Promise<void>;
  sync: (source: AiSource) => Promise<void>;
  setEnabled: (source: AiSource, enabled: boolean) => Promise<void>;
}

const AI_SOURCES: AiSource[] = ["notion", "granola"];
const empty = (): SourceState => ({
  available: false,
  enabled: false,
  running: false,
  lastSyncAt: null,
  lastError: null,
});

// Like Slack-via-claude, these rounds are heavy agentic reads — sync on open
// plus roughly hourly while the app stays focused.
const INTERVAL_MS = 60 * 60_000;
let armed = false;

export const useAiSources = create<AiSourcesState>((set, get) => ({
  sources: { notion: empty(), granola: empty() },
  loaded: false,

  init: async () => {
    for (const source of AI_SOURCES) {
      const s = await aiSourceStatus(source);
      set((st) => ({
        sources: {
          ...st.sources,
          [source]: {
            ...st.sources[source],
            available: s.available,
            enabled: s.enabled,
            lastSyncAt: s.last_sync_at,
            lastError: s.last_error,
          },
        },
      }));
      if (s.enabled) void get().sync(source); // analyze on open
    }
    set({ loaded: true });

    if (!armed) {
      armed = true;
      setInterval(() => {
        for (const source of AI_SOURCES) {
          const st = get().sources[source];
          if (st.enabled && !st.running && document.hasFocus()) void get().sync(source);
        }
      }, INTERVAL_MS);
    }
  },

  sync: async (source) => {
    const st = get().sources[source];
    if (st.running || !st.enabled) return;
    const patch = (p: Partial<SourceState>) =>
      set((s) => ({ sources: { ...s.sources, [source]: { ...s.sources[source], ...p } } }));

    patch({ running: true, lastError: null });
    try {
      await aiSourceSync(source);
      await useInbox.getState().reload();
      patch({ lastSyncAt: Date.now() });
    } catch (e) {
      patch({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      patch({ running: false });
    }
  },

  setEnabled: async (source, enabled) => {
    await aiSourceSet(source, enabled);
    set((s) => ({ sources: { ...s.sources, [source]: { ...s.sources[source], enabled } } }));
    if (enabled && !get().sources[source].lastSyncAt) void get().sync(source);
  },
}));
