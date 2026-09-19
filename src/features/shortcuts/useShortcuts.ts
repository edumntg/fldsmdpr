import { useEffect } from "react";
import { useUi, sectionOrder } from "../../stores/ui";
import { useSlackAi } from "../../stores/slackAi";
import { useInbox } from "../../stores/inbox";
import { useSync } from "../../stores/sync";
import { useTheme } from "../../stores/theme";
import { useTerminal } from "../../stores/terminal";
import { isTyping, modKey } from "../../lib/utils";
import {
  markDone,
  toggleRead,
  togglePin,
  snooze,
  copyLink,
  openItem,
  askAbout,
  SNOOZE_OPTIONS,
} from "../../lib/actions";

/** One row of the `?` cheat sheet. */
export const SHORTCUTS: { group: string; keys: string[]; label: string }[] = [
  { group: "Navigate", keys: ["j", "k"], label: "Next / previous item" },
  { group: "Navigate", keys: [`${modKey}`, "1…9"], label: "Jump to a section" },
  { group: "Navigate", keys: [`${modKey}`, "K"], label: "Command palette & search" },
  { group: "Navigate", keys: [`${modKey}`, "F"], label: "Filter the current list" },
  { group: "Navigate", keys: ["esc"], label: "Deselect / close" },
  { group: "Item", keys: ["e"], label: "Mark done (undoable)" },
  { group: "Item", keys: ["s"], label: "Snooze until tomorrow 9 AM" },
  { group: "Item", keys: ["⇧", "S"], label: "Snooze 1 hour" },
  { group: "Item", keys: ["u"], label: "Toggle read / unread" },
  { group: "Item", keys: ["p"], label: "Pin to top" },
  { group: "Item", keys: ["o"], label: "Open in browser" },
  { group: "Item", keys: ["a"], label: "Ask Claude about this" },
  { group: "Item", keys: [`${modKey}`, "⇧", "C"], label: "Copy link" },
  { group: "App", keys: [`${modKey}`, "R"], label: "Refresh" },
  { group: "App", keys: [`${modKey}`, "J"], label: "Toggle terminal" },
  { group: "App", keys: [`${modKey}`, ","], label: "Settings" },
  { group: "App", keys: [`${modKey}`, "+ / −"], label: "Zoom in / out" },
  { group: "App", keys: ["?"], label: "This cheat sheet" },
];

/** Global keyboard shortcuts. List-local j/k live in NotificationList. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = e.metaKey || e.ctrlKey;

      // ---- modifier shortcuts work everywhere (even in inputs) ----
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
          const target = sectionOrder(useSlackAi.getState().enabled)[Number(e.key) - 1];
          if (target) {
            e.preventDefault();
            ui.setSection(target);
          }
          return;
        }
        if (k === "r" && !e.shiftKey) {
          e.preventDefault();
          void useSync.getState().sync();
          return;
        }
        if (k === "j") {
          e.preventDefault();
          useTerminal.getState().toggle();
          return;
        }
        if (k === ",") {
          e.preventDefault();
          ui.setSection("settings");
          return;
        }
        if (k === "f" && !e.shiftKey) {
          const input = document.getElementById("list-filter") as HTMLInputElement | null;
          if (input) {
            e.preventDefault();
            input.focus();
            input.select();
          }
          return;
        }
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          useTheme.getState().zoomIn();
          return;
        }
        if (e.key === "-") {
          e.preventDefault();
          useTheme.getState().zoomOut();
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          useTheme.getState().zoomReset();
          return;
        }
        if (k === "c" && e.shiftKey) {
          const n = selected();
          if (n) {
            e.preventDefault();
            void copyLink(n);
          }
          return;
        }
        return;
      }

      if (isTyping(e) || e.altKey) return;

      if (e.key === "?") {
        e.preventDefault();
        ui.setHelpOpen(!ui.helpOpen);
        return;
      }
      if (e.key === "Escape") {
        if (ui.helpOpen) ui.setHelpOpen(false);
        else if (!ui.paletteOpen && ui.selectedId) ui.select(null);
        return;
      }
      if (ui.paletteOpen || ui.helpOpen) return;

      const n = selected();
      if (!n) return;
      switch (e.key) {
        case "e":
          e.preventDefault();
          markDone(n);
          break;
        case "s":
          e.preventDefault();
          void snooze(n, SNOOZE_OPTIONS[2].until(), SNOOZE_OPTIONS[2].label);
          break;
        case "S":
          e.preventDefault();
          void snooze(n, SNOOZE_OPTIONS[0].until(), SNOOZE_OPTIONS[0].label);
          break;
        case "u":
          e.preventDefault();
          toggleRead(n);
          break;
        case "p":
          e.preventDefault();
          togglePin(n);
          break;
        case "o":
        case "Enter":
          if (n.url || n.meta?.link) {
            e.preventDefault();
            openItem(n);
          }
          break;
        case "a":
          e.preventDefault();
          askAbout(n);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function selected() {
  const id = useUi.getState().selectedId;
  return id ? useInbox.getState().items.find((n) => n.id === id) : undefined;
}
