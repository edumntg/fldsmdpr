import { useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox,
  GitPullRequest,
  MessageSquare,
  CircleDot,
  Calendar,
  Bot,
  Settings,
  Search,
  Moon,
  Sun,
  MonitorSmartphone,
  RefreshCw,
  GraduationCap,
} from "lucide-react";
import { useUi } from "../../stores/ui";
import { useTheme } from "../../stores/theme";
import { useSync } from "../../stores/sync";
import { useOnboarding } from "../onboarding/Onboarding";
import type { SectionId } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Kbd } from "../../components/ui/Kbd";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Inbox;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setSection } = useUi();
  const setThemePref = useTheme((s) => s.setPref);
  const sync = useSync((s) => s.sync);
  const startOnboarding = useOnboarding((s) => s.start);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (id: SectionId, label: string, icon: typeof Inbox): Command => ({
      id: `go-${id}`,
      label: `Go to ${label}`,
      icon,
      run: () => setSection(id),
    });
    return [
      go("inbox", "Inbox", Inbox),
      go("prs", "Pull Requests", GitPullRequest),
      go("slack", "Slack", MessageSquare),
      go("tickets", "Tickets", CircleDot),
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
    ];
  }, [setSection, setThemePref, sync, startOnboarding]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

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
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  useEffect(() => setActive(0), [query]);

  if (!paletteOpen) return null;

  const runCommand = (c: Command) => {
    setPaletteOpen(false);
    c.run();
  };

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
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && results[active]) {
                runCommand(results[active]);
              }
            }}
            placeholder="Type a command or search…"
            className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-ink-3">No matching commands</li>
          )}
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => runCommand(c)}
                className={cn(
                  "flex w-full cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-[13px]",
                  i === active ? "bg-accent text-accent-fg" : "text-ink-2",
                )}
              >
                <c.icon size={15} className="shrink-0" />
                <span className="flex-1 text-left font-medium">{c.label}</span>
                {c.hint && <span className="text-xs opacity-60">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
