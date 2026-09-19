/**
 * Item actions shared by the detail pane, context menu, command palette and
 * keyboard shortcuts — one implementation, one undo behavior.
 */
import type { AppNotification } from "./types";
import { useInbox, isPinned } from "../stores/inbox";
import { useUi } from "../stores/ui";
import { useAsk } from "../stores/ask";
import { toast } from "../stores/toast";
import { copyText, openExternal } from "./utils";
import { setNotificationState } from "./ipc";

/** Agent action labels by Jev's `action` choice. */
const JEV_ACTION_LABEL: Record<string, string> = {
  review_code: "Review with agent",
  fix_bug: "Fix with agent",
  investigate: "Investigate with agent",
  reply: "Draft reply",
  implement: "Run agent on this task",
};

/** Default agent action for an item: Jev's judgment when available, else by type. */
export function defaultAction(n: AppNotification): string | null {
  const jev = n.meta?.jev_action;
  if (jev === "none" && n.source !== "github" && n.source !== "linear" && n.source !== "sentry") return null;
  if (jev && JEV_ACTION_LABEL[jev]) return JEV_ACTION_LABEL[jev];
  switch (n.type) {
    case "pr_review":
      return "Review with agent";
    case "pr_update":
    case "incident":
      return "Fix with agent";
    case "ticket":
    case "assigned":
    case "action_item":
      return "Run agent on this task";
    case "mention":
    case "ai_inferred":
      return "Draft reply";
    case "follow_up":
      return "Draft a nudge";
    default:
      return null;
  }
}

export const JEV_URGENCY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  today: "Today",
  this_week: "This week",
  fyi: "FYI",
};

export function markDone(n: AppNotification) {
  const { setState } = useInbox.getState();
  const prev = n.state;
  setState(n.id, "done");
  useUi.getState().select(null);
  toast("Marked done", {
    action: { label: "Undo", run: () => setState(n.id, prev === "done" ? "read" : prev) },
  });
}

export function toggleRead(n: AppNotification) {
  useInbox.getState().setState(n.id, n.state === "unread" ? "read" : "unread");
}

export function togglePin(n: AppNotification) {
  const pinned = !isPinned(n);
  useInbox.getState().setMeta(n.id, "pinned", pinned ? "1" : "");
  toast(pinned ? "Pinned to top" : "Unpinned");
}

export const SNOOZE_OPTIONS: { label: string; until: () => number }[] = [
  { label: "In 1 hour", until: () => Date.now() + 3600_000 },
  { label: "In 4 hours", until: () => Date.now() + 4 * 3600_000 },
  { label: "Tomorrow 9 AM", until: () => nextAt(9, 1) },
  { label: "Next Monday", until: () => nextMonday() },
];

function nextAt(hour: number, daysAhead: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

function nextMonday() {
  const d = new Date();
  const days = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export async function snooze(n: AppNotification, until: number, label?: string) {
  const { snooze, reload } = useInbox.getState();
  useUi.getState().select(null);
  await snooze(n.id, until);
  toast(`Snoozed${label ? ` · ${label}` : ""}`, {
    action: {
      label: "Undo",
      run: async () => {
        await setNotificationState(n.id, n.state === "done" ? "read" : n.state);
        await reload();
      },
    },
  });
}

export async function copyLink(n: AppNotification) {
  if (!n.url) return;
  toast((await copyText(n.url)) ? "Link copied" : "Couldn't copy", { tone: n.url ? "success" : "danger" });
}

export async function copyMarkdown(n: AppNotification) {
  const md = n.url ? `[${n.title}](${n.url})` : n.title;
  toast((await copyText(md)) ? "Copied as Markdown" : "Couldn't copy");
}

export function openItem(n: AppNotification) {
  void openExternal(n.meta?.link ?? n.url);
}

/** Jump to Ask with the item's context pre-typed. */
export function askAbout(n: AppNotification) {
  const ref = n.meta?.number ?? n.meta?.key ?? n.title;
  useAsk.getState().setPrefill(`About "${ref}": what should I know, and what's the next step?`);
  useUi.getState().setSection("ask");
}
