import { create } from "zustand";
import { askClaude, type ChatTurn } from "../lib/ipc";

interface AskState {
  messages: ChatTurn[];
  running: boolean;
  error: string | null;
  send: (question: string) => Promise<void>;
  clear: () => void;
}

/** Chat with claude over the app's own data (session-scoped history). */
export const useAsk = create<AskState>((set, get) => ({
  messages: [],
  running: false,
  error: null,

  send: async (question) => {
    const q = question.trim();
    if (!q || get().running) return;
    const history = get().messages;
    set({ messages: [...history, { role: "user", content: q }], running: true, error: null });
    try {
      const answer = await askClaude(q, history);
      set((s) => ({ messages: [...s.messages, { role: "assistant", content: answer }] }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false });
    }
  },

  clear: () => set({ messages: [], error: null }),
}));
