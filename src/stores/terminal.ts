import { create } from "zustand";

export interface TermTab {
  id: string; // client-side tab id (distinct from the pty session id)
  title: string;
  kind: "shell" | "claude";
  cwd?: string;
  /** For claude tabs: text written to the pty once it's ready. */
  seedPrompt?: string;
  /** For claude tabs launched from a notification: links the tab to its agent run. */
  notificationId?: string;
}

interface TerminalState {
  open: boolean;
  tabs: TermTab[];
  activeId: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  newShell: () => void;
  openClaude: (opts: {
    cwd?: string;
    prompt: string;
    title: string;
    notificationId?: string;
  }) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
}

let seq = 1;
const tabId = () => `tab-${seq++}`;

export const useTerminal = create<TerminalState>((set, get) => ({
  open: false,
  tabs: [],
  activeId: null,

  setOpen: (open) => set({ open }),
  toggle: () => {
    const { open, tabs } = get();
    if (!open && tabs.length === 0) get().newShell();
    set({ open: !open });
  },

  newShell: () => {
    const id = tabId();
    const n = get().tabs.filter((t) => t.kind === "shell").length + 1;
    set((s) => ({
      tabs: [...s.tabs, { id, title: `Terminal ${n}`, kind: "shell" }],
      activeId: id,
      open: true,
    }));
  },

  openClaude: ({ cwd, prompt, title, notificationId }) => {
    const id = tabId();
    set((s) => ({
      tabs: [...s.tabs, { id, title, kind: "claude", cwd, seedPrompt: prompt, notificationId }],
      activeId: id,
      open: true,
    }));
  },

  activate: (id) => set({ activeId: id }),

  close: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId =
        s.activeId === id ? (tabs.length ? tabs[tabs.length - 1].id : null) : s.activeId;
      return { tabs, activeId, open: tabs.length > 0 ? s.open : false };
    }),
}));
