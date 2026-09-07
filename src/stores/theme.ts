import { create } from "zustand";
import { kvGet, kvSet } from "../lib/ipc";

export type ThemePref = "system" | "light" | "dark";

interface ThemeState {
  pref: ThemePref;
  resolved: "light" | "dark";
  setPref: (pref: ThemePref) => void;
  init: () => Promise<void>;
}

const media = window.matchMedia("(prefers-color-scheme: dark)");

function resolve(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (media.matches ? "dark" : "light") : pref;
}

function apply(resolved: "light" | "dark") {
  document.documentElement.dataset.theme = resolved;
}

export const useTheme = create<ThemeState>((set, get) => {
  media.addEventListener("change", () => {
    const { pref } = get();
    if (pref === "system") {
      const resolved = resolve(pref);
      apply(resolved);
      set({ resolved });
    }
  });

  return {
    pref: "system",
    resolved: resolve("system"),
    setPref: (pref) => {
      const resolved = resolve(pref);
      apply(resolved);
      set({ pref, resolved });
      void kvSet("theme", pref);
      // mirror for the pre-paint script in index.html (SQLite isn't readable that early)
      localStorage.setItem("kv:theme", pref);
    },
    init: async () => {
      const saved = (await kvGet("theme")) as ThemePref | null;
      const pref = saved ?? "system";
      localStorage.setItem("kv:theme", pref);
      const resolved = resolve(pref);
      apply(resolved);
      set({ pref, resolved });
    },
  };
});
