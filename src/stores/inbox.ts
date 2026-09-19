import { create } from "zustand";
import type { AppNotification, NotificationState, SectionId } from "../lib/types";
import {
  listNotifications,
  setNotificationState,
  snoozeNotification,
  notificationSetMeta,
  markReadMany,
} from "../lib/ipc";
import { mockNotifications } from "../features/inbox/mockData";
import type { SortBy, Range } from "./ui";

interface InboxState {
  items: AppNotification[];
  loaded: boolean;
  /** Load from SQLite (inside Tauri) or mock data (browser preview). */
  reload: () => Promise<void>;
  setState: (id: string, state: NotificationState) => void;
  /** Snooze: drops the item from the list now, persists in the background. */
  snooze: (id: string, until: number) => Promise<void>;
  /** Merge one meta key locally + persist (pins, linked tickets…). */
  setMeta: (id: string, key: string, value: string) => void;
  markRead: (ids: string[]) => void;
  /** Add a notification found via search (e.g. archived) so it can be selected. */
  inject: (n: AppNotification) => void;
}

export const useInbox = create<InboxState>((set) => ({
  items: [],
  loaded: false,
  reload: async () => {
    const rows = await listNotifications();
    set({ items: rows ?? mockNotifications, loaded: true });
  },
  setState: (id, state) => {
    set((s) => ({ items: s.items.map((n) => (n.id === id ? { ...n, state } : n)) }));
    void setNotificationState(id, state); // persist; no-op in browser preview
  },
  snooze: async (id, until) => {
    set((s) => ({ items: s.items.filter((n) => n.id !== id) }));
    await snoozeNotification(id, until);
  },
  setMeta: (id, key, value) => {
    set((s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, meta: { ...n.meta, [key]: value } } : n)),
    }));
    void notificationSetMeta(id, key, value);
  },
  markRead: (ids) => {
    const set_ = new Set(ids);
    set((s) => ({
      items: s.items.map((n) => (set_.has(n.id) && n.state === "unread" ? { ...n, state: "read" } : n)),
    }));
    void markReadMany(ids);
  },
  inject: (n) =>
    set((s) => (s.items.some((i) => i.id === n.id) ? s : { items: [n, ...s.items] })),
}));

const sectionSources: Partial<Record<SectionId, AppNotification["source"][]>> = {
  prs: ["github"],
  slack: ["slack"],
  tickets: ["linear"],
  errors: ["sentry"],
  meetings: ["granola"],
  calendar: ["gcal"],
  agents: ["agent"],
};

export const isPinned = (n: AppNotification) => n.meta?.pinned === "1";

/** Sections where Sentry is hidden unless the user toggles it on. */
const SENTRY_OPTIONAL: SectionId[] = ["inbox", "today"];

export function filterBySection(
  items: AppNotification[],
  section: SectionId,
  sortBy: SortBy = "priority",
  showSentry = true,
): AppNotification[] {
  const hideSentry = !showSentry && SENTRY_OPTIONAL.includes(section);
  const active = items.filter((n) => n.state !== "done" && !(hideSentry && n.source === "sentry"));
  const sources = sectionSources[section];
  const filtered = sources ? active.filter((n) => sources.includes(n.source)) : active;
  return [...filtered].sort(
    (a, b) =>
      Number(isPinned(b)) - Number(isPinned(a)) ||
      (sortBy === "priority" ? b.priority - a.priority || b.createdAt - a.createdAt : b.createdAt - a.createdAt),
  );
}

const RANGE_MS: Record<Range, number> = { all: Infinity, today: 0, "3d": 3 * 86_400_000, "7d": 7 * 86_400_000 };

/** Time-window filter. "today" = since local midnight; future items (events) always pass. */
export function inRange(n: AppNotification, range: Range, now = Date.now()): boolean {
  if (range === "all") return true;
  if (n.createdAt >= now) return true;
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return n.createdAt >= d.getTime();
  }
  return now - n.createdAt <= RANGE_MS[range];
}

/** Unread counts for every section in one pass (the sidebar renders 10 badges). */
export function unreadCounts(items: AppNotification[], showSentry = true): Partial<Record<SectionId, number>> {
  const out: Partial<Record<SectionId, number>> = {};
  for (const n of items) {
    if (n.state !== "unread") continue;
    if (showSentry || n.source !== "sentry") out.inbox = (out.inbox ?? 0) + 1;
    for (const [section, sources] of Object.entries(sectionSources) as [SectionId, AppNotification["source"][]][]) {
      if (sources.includes(n.source)) out[section] = (out[section] ?? 0) + 1;
    }
  }
  return out;
}
