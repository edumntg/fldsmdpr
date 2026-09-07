import { create } from "zustand";
import type { AppNotification, NotificationState, SectionId } from "../lib/types";
import { mockNotifications } from "../features/inbox/mockData";

interface InboxState {
  items: AppNotification[];
  setState: (id: string, state: NotificationState) => void;
}

// Phase 0: mock data. Phase 1 swaps this for SQLite-backed queries via IPC.
export const useInbox = create<InboxState>((set) => ({
  items: mockNotifications,
  setState: (id, state) =>
    set((s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, state } : n)),
    })),
}));

const sectionSources: Partial<Record<SectionId, AppNotification["source"][]>> = {
  prs: ["github"],
  slack: ["slack"],
  tickets: ["linear"],
  calendar: ["gcal"],
  agents: ["agent"],
};

export function filterBySection(items: AppNotification[], section: SectionId): AppNotification[] {
  const active = items.filter((n) => n.state !== "done");
  const sources = sectionSources[section];
  const filtered = sources ? active.filter((n) => sources.includes(n.source)) : active;
  return [...filtered].sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
}

export function unreadCount(items: AppNotification[], section: SectionId): number {
  return filterBySection(items, section).filter((n) => n.state === "unread").length;
}
