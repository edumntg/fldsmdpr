import { create } from "zustand";
import type { SectionId } from "../lib/types";

export type SortBy = "priority" | "newest";
export type Range = "all" | "today" | "3d" | "7d";
export type P0Window = "today" | "week";
export const P0_WINDOW_LABELS: Record<P0Window, string> = { today: "Today", week: "This week" };
export const RANGE_LABELS: Record<Range, string> = { all: "All time", today: "Today", "3d": "3 days", "7d": "Week" };

interface UiState {
  section: SectionId;
  setSection: (s: SectionId) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  unreadOnly: boolean;
  toggleUnreadOnly: () => void;
  sortBy: SortBy;
  toggleSort: () => void;
  /** Only items created within this window (calendar items in the future always pass). */
  range: Range;
  setRange: (r: Range) => void;
  /** Sentry errors stay out of Inbox/Today unless toggled on (the Errors section always shows them). */
  showSentry: boolean;
  toggleSentry: () => void;
  /** Today → "P0 · Urgent": how many picks (3–5) and over which window. */
  p0Count: number;
  setP0Count: (n: number) => void;
  p0Window: P0Window;
  setP0Window: (w: P0Window) => void;
}

const SECTIONS: SectionId[] = [
  "today", "ask", "flow", "inbox", "prs", "slack", "tickets", "errors", "meetings", "calendar", "agents", "settings",
];
const savedSection = localStorage.getItem("ui:section") as SectionId | null;

export const useUi = create<UiState>((set) => ({
  section: savedSection && SECTIONS.includes(savedSection) ? savedSection : "inbox",
  setSection: (section) => {
    localStorage.setItem("ui:section", section);
    set({ section, selectedId: null });
  },
  sidebarCollapsed: localStorage.getItem("ui:sidebar") === "collapsed",
  toggleSidebar: () =>
    set((s) => {
      const sidebarCollapsed = !s.sidebarCollapsed;
      localStorage.setItem("ui:sidebar", sidebarCollapsed ? "collapsed" : "open");
      return { sidebarCollapsed };
    }),
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  unreadOnly: localStorage.getItem("ui:unreadOnly") === "1",
  toggleUnreadOnly: () =>
    set((s) => {
      localStorage.setItem("ui:unreadOnly", s.unreadOnly ? "0" : "1");
      return { unreadOnly: !s.unreadOnly };
    }),
  sortBy: (localStorage.getItem("ui:sortBy") as SortBy | null) ?? "priority",
  toggleSort: () =>
    set((s) => {
      const sortBy: SortBy = s.sortBy === "priority" ? "newest" : "priority";
      localStorage.setItem("ui:sortBy", sortBy);
      return { sortBy };
    }),
  range: (localStorage.getItem("ui:range") as Range | null) ?? "all",
  setRange: (range) => {
    localStorage.setItem("ui:range", range);
    set({ range });
  },
  showSentry: localStorage.getItem("ui:showSentry") === "1",
  toggleSentry: () =>
    set((s) => {
      localStorage.setItem("ui:showSentry", s.showSentry ? "0" : "1");
      return { showSentry: !s.showSentry };
    }),
  p0Count: Math.min(5, Math.max(3, Number(localStorage.getItem("ui:p0Count")) || 3)),
  setP0Count: (n) => {
    const p0Count = Math.min(5, Math.max(3, n));
    localStorage.setItem("ui:p0Count", String(p0Count));
    set({ p0Count });
  },
  p0Window: (localStorage.getItem("ui:p0Window") as P0Window | null) ?? "today",
  setP0Window: (p0Window) => {
    localStorage.setItem("ui:p0Window", p0Window);
    set({ p0Window });
  },
}));

/** Sidebar order (Slack only when its master switch is on). */
const ALL_SECTIONS: SectionId[] = [
  "today", "ask", "flow", "inbox", "prs", "slack", "tickets", "errors", "meetings", "calendar", "agents",
];
export const sectionOrder = (slackEnabled: boolean): SectionId[] =>
  slackEnabled ? ALL_SECTIONS : ALL_SECTIONS.filter((s) => s !== "slack");
