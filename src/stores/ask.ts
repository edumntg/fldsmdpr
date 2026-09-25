import { create } from "zustand";
import { persist } from "zustand/middleware";
import { askAi, type ChatTurn } from "../lib/ipc";

export interface Chat {
  id: string;
  title: string;
  messages: ChatTurn[];
  updatedAt: number;
}

interface AskState {
  chats: Chat[];
  activeId: string | null;
  /** Chat currently waiting on an answer (one request at a time). */
  runningId: string | null;
  error: string | null;
  /** Text to seed the composer with (set by "Ask about this"); consumed on mount. */
  prefill: string | null;
  setPrefill: (text: string | null) => void;
  /** Start a fresh conversation (the next send creates it). */
  newChat: () => void;
  select: (id: string) => void;
  remove: (id: string) => void;
  send: (question: string) => Promise<void>;
}

const patch = (chats: Chat[], id: string, fn: (c: Chat) => Chat) =>
  chats.map((c) => (c.id === id ? fn(c) : c));

/** Chat with the AI over the app's own data. Conversations persist in localStorage. */
export const useAsk = create<AskState>()(
  persist(
    (set, get) => ({
      chats: [],
      activeId: null,
      runningId: null,
      error: null,
      prefill: null,
      setPrefill: (prefill) => set({ prefill, activeId: null, error: null }),
      newChat: () => set({ activeId: null, error: null }),
      select: (activeId) => set({ activeId, error: null }),
      remove: (id) =>
        set((s) => ({
          chats: s.chats.filter((c) => c.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),

      send: async (question) => {
        const q = question.trim();
        if (!q || get().runningId) return;
        let id = get().activeId;
        let chat = get().chats.find((c) => c.id === id);
        if (!chat) {
          id = crypto.randomUUID();
          chat = { id, title: q.slice(0, 60), messages: [], updatedAt: Date.now() };
          set((s) => ({ chats: [chat!, ...s.chats], activeId: id }));
        }
        const chatId = id!;
        const history = chat.messages;
        set((s) => ({
          chats: patch(s.chats, chatId, (c) => ({
            ...c,
            messages: [...history, { role: "user", content: q }],
            updatedAt: Date.now(),
          })),
          runningId: chatId,
          error: null,
        }));
        try {
          const answer = await askAi(q, history);
          set((s) => ({
            chats: patch(s.chats, chatId, (c) => ({
              ...c,
              messages: [...c.messages, { role: "assistant", content: answer }],
              updatedAt: Date.now(),
            })),
          }));
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        } finally {
          set({ runningId: null });
        }
      },
    }),
    { name: "ask:chats", partialize: (s) => ({ chats: s.chats, activeId: s.activeId }) },
  ),
);
