import { useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox,
  GitPullRequest,
  MessageSquare,
  Waypoints,
  CircleDot,
  Calendar,
  Bot,
  Settings,
  Search,
  Moon,
  Sun,
  Sunrise,
  MonitorSmartphone,
  RefreshCw,
  GraduationCap,
  Flame,
  NotebookPen,
  Sparkles,
  Check,
  Clock,
  Pin,
  Link2,
  ExternalLink,
  Keyboard,
  Palette,
  MessageCircleQuestion,
} from "lucide-react";
import { markDone, snooze, togglePin, copyLink, openItem, askAbout, SNOOZE_OPTIONS } from "../../lib/actions";
import { ACCENTS } from "../../stores/theme";
import { isPinned } from "../../stores/inbox";
import { useSlackAi } from "../../stores/slackAi";
import { useUi } from "../../stores/ui";
import { useTheme } from "../../stores/theme";
import { useSync } from "../../stores/sync";
import { useInbox } from "../../stores/inbox";
import { useOnboarding } from "../onboarding/Onboarding";
import { searchNotifications } from "../../lib/ipc";
import type { AppNotification, SectionId } from "../../lib/types";
import { cn, relativeTime } from "../../lib/utils";
import { Kbd } from "../../components/ui/Kbd";
import { SourceBadge } from "../../components/ui/SourceBadge";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Inbox;
  run: () => void;
}

/** Flattened row model so ↑/↓ walks commands and search hits as one list. */
type Row = { kind: "command"; c: Command } | { kind: "notification"; n: AppNotification };

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setSection, select, selectedId, setHelpOpen, showSentry, toggleSentry } = useUi();
  const setThemePref = useTheme((s) => s.setPref);
  const setAccent = useTheme((s) => s.setAccent);
  const selected = useInbox((s) => s.items.find((n) => n.id === selectedId));
  const slackEnabled = useSlackAi((s) => s.enabled);
  const sync = useSync((s) => s.sync);
  const startOnboarding = useOnboarding((s) => s.start);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<AppNotification[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (id: SectionId, label: string, icon: typeof Inbox): Command => ({
      id: `go-${id}`,
      label: `Go to ${label}`,
      icon,
      run: () => setSection(id),
    });
    const itemCmds: Command[] = selected
      ? [
          { id: "done", label: "Mark done", hint: "e", icon: Check, run: () => markDone(selected) },
          ...SNOOZE_OPTIONS.map((o) => ({
            id: `snooze-${o.label}`,
            label: `Snooze · ${o.label}`,
            icon: Clock,
            run: () => void snooze(selected, o.until(), o.label),
          })),
          { id: "pin", label: isPinned(selected) ? "Unpin" : "Pin to top", hint: "p", icon: Pin, run: () => togglePin(selected) },
          { id: "ask-about", label: "Ask Claude about this", hint: "a", icon: MessageCircleQuestion, run: () => askAbout(selected) },
          ...(selected.url
            ? [
                { id: "open", label: "Open in browser", hint: "o", icon: ExternalLink, run: () => openItem(selected) },
                { id: "copy", label: "Copy link", hint: "⌘⇧C", icon: Link2, run: () => void copyLink(selected) },
              ]
            : []),
        ]
      : [];
    return [
      ...itemCmds,
      go("today", "Today", Sunrise),
      go("ask", "Ask (chat with your data)", Sparkles),
      go("flow", "Flow (live pipeline)", Waypoints),
      go("inbox", "Inbox", Inbox),
      go("prs", "Pull Requests", GitPullRequest),
      ...(slackEnabled ? [go("slack", "Slack", MessageSquare)] : []),
      go("tickets", "Tickets", CircleDot),
      go("errors", "Errors", Flame),
      go("meetings", "Meetings", NotebookPen),
      go("calendar", "Calendar", Calendar),
      go("agents", "Agents", Bot),
      go("settings", "Settings", Settings),
      { id: "refresh", label: "Refresh inbox", icon: RefreshCw, run: () => void sync() },
      {
        id: "onboarding",
        label: "Run setup guide (connections)",
        icon: GraduationCap,
        run: startOnboarding,
      },
      { id: "theme-light", label: "Theme: Light", icon: Sun, run: () => setThemePref("light") },
      { id: "theme-dark", label: "Theme: Dark", icon: Moon, run: () => setThemePref("dark") },
      {
        id: "theme-system",
        label: "Theme: Follow system",
        icon: MonitorSmartphone,
        run: () => setThemePref("system"),
      },
      ...ACCENTS.map((a) => ({
        id: `accent-${a.id}`,
        label: `Accent: ${a.label}`,
        icon: Palette,
        run: () => setAccent(a.id),
      })),
      { id: "shortcuts", label: "Keyboard shortcuts", hint: "?", icon: Keyboard, run: () => setHelpOpen(true) },
      {
        id: "toggle-sentry",
        label: showSentry ? "Hide Sentry errors in Inbox & Today" : "Show Sentry errors in Inbox & Today",
        icon: Flame,
        run: toggleSentry,
      },
    ];
  }, [setSection, setThemePref, setAccent, sync, startOnboarding, selected, setHelpOpen, showSentry, toggleSentry, slackEnabled]);

  // Full-text search over everything ever received (incl. done/archived) —
  // debounced so typing doesn't hammer SQLite.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchNotifications(q)
        .then((rows) => !cancelled && setFound(rows))
        .catch(() => !cancelled && setFound([]));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const cmds = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    return [
      ...cmds.map((c): Row => ({ kind: "command", c })),
      ...found.map((n): Row => ({ kind: "notification", n })),
    ];
  }, [commands, query, found]);

  // global ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setFound([]);
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  useEffect(() => setActive(0), [query]);

  if (!paletteOpen) return null;

  const runRow = (r: Row) => {
    setPaletteOpen(false);
    if (r.kind === "command") {
      r.c.run();
    } else {
      // Archived/done hits may not be in the live inbox list — inject first.
      useInbox.getState().inject(r.n);
      setSection("inbox");
      select(r.n.id);
    }
  };

  const firstNotificationIdx = rows.findIndex((r) => r.kind === "notification");

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[18vh]"
      onMouseDown={() => setPaletteOpen(false)}
    >
      <div
        className="animate-pop-in w-[560px] overflow-hidden rounded-2xl border border-line-strong bg-surface-2 shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={15} className="text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && rows[active]) {
                runRow(rows[active]);
              }
            }}
            placeholder="Type a command or search all notifications…"
            className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-ink-3">
              No matching commands or notifications
            </li>
          )}
          {rows.map((r, i) => (
            <li key={r.kind === "command" ? r.c.id : `n-${r.n.id}`}>
              {i === firstNotificationIdx && (
                <p className="px-3 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-ink-3 uppercase">
                  Notifications · includes done & archived
                </p>
              )}
              {r.kind === "command" ? (
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runRow(r)}
                  className={cn(
                    "flex w-full cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors duration-100",
                    i === active ? "bg-accent text-accent-fg" : "text-ink-2",
                  )}
                >
                  <r.c.icon size={15} className="shrink-0" />
                  <span className="flex-1 text-left font-medium">{r.c.label}</span>
                  {r.c.hint && <Kbd>{r.c.hint}</Kbd>}
                </button>
              ) : (
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runRow(r)}
                  className={cn(
                    "flex w-full cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-[13px]",
                    i === active ? "bg-accent text-accent-fg" : "text-ink-2",
                  )}
                >
                  <SourceBadge source={r.n.source} size={13} n={r.n} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium">{r.n.title}</span>
                    <span className={cn("block truncate text-xs", i === active ? "opacity-70" : "text-ink-3")}>
                      {r.n.snippet}
                    </span>
                  </span>
                  {r.n.state === "done" && (
                    <span
                      className={cn(
                        "shrink-0 rounded-pill px-1.5 py-px text-[10px] font-medium",
                        i === active ? "bg-white/20" : "bg-surface-3 text-ink-3",
                      )}
                    >
                      Done
                    </span>
                  )}
                  <span className={cn("shrink-0 text-xs", i === active ? "opacity-70" : "text-ink-3")}>
                    {relativeTime(r.n.createdAt)}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
