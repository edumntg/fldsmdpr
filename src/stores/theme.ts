import { create } from "zustand";
import { kvGet, kvSet } from "../lib/ipc";

export type ThemePref = "system" | "light" | "dark";
export type Accent = "blue" | "violet" | "teal" | "rose" | "amber" | "green";
export type Density = "comfortable" | "compact";

export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: "blue", label: "Blue", swatch: "#3574f0" },
  { id: "violet", label: "Violet", swatch: "#7c5cf0" },
  { id: "teal", label: "Teal", swatch: "#0e9f9f" },
  { id: "rose", label: "Rose", swatch: "#e0457b" },
  { id: "amber", label: "Amber", swatch: "#d98a06" },
  { id: "green", label: "Green", swatch: "#1f9d55" },
];

const ZOOM_STEPS = [0.85, 0.9, 1, 1.1, 1.2, 1.3];

interface ThemeState {
  pref: ThemePref;
  resolved: "light" | "dark";
  accent: Accent;
  density: Density;
  zoom: number;
  setPref: (pref: ThemePref) => void;
  setAccent: (a: Accent) => void;
  setDensity: (d: Density) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  init: () => Promise<void>;
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
const root = document.documentElement;

function resolve(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (media.matches ? "dark" : "light") : pref;
}

/** Crossfade colors for one beat while the theme flips (see .theme-switching in global.css). */
let switchTimer: number | undefined;
function withTransition(fn: () => void) {
  root.classList.add("theme-switching");
  fn();
  window.clearTimeout(switchTimer);
  switchTimer = window.setTimeout(() => root.classList.remove("theme-switching"), 320);
}

function applyZoom(z: number) {
  // WebKit `zoom` scales the whole tree consistently (px + rem alike).
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(z);
  localStorage.setItem("ui:zoom", String(z));
}

export const useTheme = create<ThemeState>((set, get) => {
  media.addEventListener("change", () => {
    const { pref } = get();
    if (pref === "system") {
      const resolved = resolve(pref);
      withTransition(() => (root.dataset.theme = resolved));
      set({ resolved });
    }
  });

  const zoomTo = (z: number) => {
    applyZoom(z);
    set({ zoom: z });
  };
  const step = (dir: 1 | -1) => {
    const { zoom } = get();
    const i = ZOOM_STEPS.findIndex((s) => Math.abs(s - zoom) < 0.001);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i === -1 ? 2 : i) + dir))];
    zoomTo(next);
  };

  return {
    pref: "system",
    resolved: resolve("system"),
    accent: (localStorage.getItem("ui:accent") as Accent | null) ?? "blue",
    density: (localStorage.getItem("ui:density") as Density | null) ?? "comfortable",
    zoom: Number(localStorage.getItem("ui:zoom")) || 1,
    setPref: (pref) => {
      const resolved = resolve(pref);
      withTransition(() => (root.dataset.theme = resolved));
      set({ pref, resolved });
      void kvSet("theme", pref);
      // mirror for the pre-paint script in index.html (SQLite isn't readable that early)
      localStorage.setItem("kv:theme", pref);
    },
    setAccent: (accent) => {
      withTransition(() => (root.dataset.accent = accent));
      localStorage.setItem("ui:accent", accent);
      set({ accent });
    },
    setDensity: (density) => {
      root.dataset.density = density;
      localStorage.setItem("ui:density", density);
      set({ density });
    },
    zoomIn: () => step(1),
    zoomOut: () => step(-1),
    zoomReset: () => zoomTo(1),
    init: async () => {
      const { accent, density, zoom } = get();
      root.dataset.accent = accent;
      root.dataset.density = density;
      applyZoom(zoom);
      const saved = (await kvGet("theme")) as ThemePref | null;
      const pref = saved ?? "system";
      localStorage.setItem("kv:theme", pref);
      const resolved = resolve(pref);
      root.dataset.theme = resolved;
      set({ pref, resolved });
    },
  };
});
