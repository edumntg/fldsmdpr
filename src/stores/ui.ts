import { create } from "zustand";
import type { SectionId } from "../lib/types";

interface UiState {
  section: SectionId;
  setSection: (s: SectionId) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  section: "inbox",
  setSection: (section) => set({ section, selectedId: null }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
