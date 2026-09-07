import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  InboxIcon,
  RefreshCw,
  Layers,
  ChevronDown,
  Check,
  Bot,
  TerminalSquare,
  ExternalLink,
  Eye,
  CircleDot,
  Loader2,
} from "lucide-react";
import { useInbox, filterBySection } from "../../stores/inbox";
import { useUi } from "../../stores/ui";
import { useSync } from "../../stores/sync";
import { useAgents } from "../../stores/agents";
import { useSlackAi } from "../../stores/slackAi";
import type { AppNotification, SectionId, NotificationType } from "../../lib/types";
import { cn, relativeTime } from "../../lib/utils";
import { SourceBadge, sourceLabel } from "../../components/ui/SourceBadge";
import { Chip } from "../../components/ui/Chip";
import { IconButton } from "../../components/ui/IconButton";
import { AgentStatusRow } from "../agents/AgentStatusRow";
import { SlackOverview } from "./SlackOverview";

/** Default agent action label per notification type (for the context menu). */
function defaultAction(type: NotificationType): string {
  switch (type) {
    case "pr_review":
      return "Review with agent";
    case "pr_update":
      return "Fix with agent";
    case "ticket":
    case "assigned":
      return "Run agent on this task";
    default:
      return "Draft reply";
  }
}

async function openUrl(url?: string) {
  if (!url) return;
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl: open } = await import("@tauri-apps/plugin-opener");
    await open(url);
  } else {
    window.open(url, "_blank");
  }
}

interface MenuState {
  n: AppNotification;
  x: number;
  y: number;
}

const sectionTitles: Record<SectionId, string> = {
  inbox: "Inbox",
  prs: "Pull Requests",
  slack: "Slack",
  tickets: "Tickets",
  calendar: "Calendar",
  agents: "Agents",
  settings: "Settings",
};

type GroupKey =
  | "none"
  | "status"
  | "priority"
  | "project"
  | "lead"
  | "cycle"
  | "team"
  | "repo"
  | "author"
  | "type"
  | "source";

// Meta field read for the straightforward keys.
const GROUP_FIELD: Partial<Record<GroupKey, string>> = {
  status: "state",
  priority: "priority",
  project: "project",
  lead: "lead",
  cycle: "cycle",
  team: "team",
  repo: "repo",
};

const GROUP_LABELS: Record<GroupKey, string> = {
  none: "No grouping",
  status: "Status",
  priority: "Priority",
  project: "Project",
  lead: "Lead",
  cycle: "Cycle",
  team: "Team",
  repo: "Repo",
  author: "Author",
  type: "Type",
  source: "Source",
};

// Grouping options offered per section.
const SECTION_GROUPS: Partial<Record<SectionId, GroupKey[]>> = {
  inbox: ["none", "source", "repo", "type"],
  prs: ["none", "repo", "author", "type"],
  tickets: ["none", "status", "priority", "project", "lead", "cycle", "team"],
};

function typeLabel(n: AppNotification): string {
  if (n.source === "github") return n.meta?.is_pr === "false" ? "Issues" : "Pull Requests";
  switch (n.type) {
    case "mention":
      return "Mentions";
    case "ai_inferred":
      return "AI-flagged";
    case "ticket":
      return "Tickets";
    case "event":
      return "Events";
    default:
      return sourceLabel(n.source);
  }
}

function groupLabelFor(n: AppNotification, by: GroupKey): string {
  if (by === "author") return n.meta?.author ?? n.meta?.from ?? "No author";
  if (by === "source") return sourceLabel(n.source);
  if (by === "type") return typeLabel(n);
  const field = GROUP_FIELD[by];
  return (field && n.meta?.[field]) || `No ${GROUP_LABELS[by].toLowerCase()}`;
}

interface Group {
  key: string;
  label: string;
  items: AppNotification[];
}

function groupItems(items: AppNotification[], by: GroupKey): Group[] {
  if (by === "none") return [{ key: "all", label: "", items }];
  const order: string[] = [];
  const map = new Map<string, AppNotification[]>();
  for (const n of items) {
    const label = groupLabelFor(n, by);
    if (!map.has(label)) {
      map.set(label, []);
      order.push(label);
    }
    map.get(label)!.push(n);
  }
  // Items arrive priority-sorted, so first appearance ~ importance order.
  return order.map((label) => ({ key: label, label, items: map.get(label)! }));
}

export function NotificationList() {
  const { section, selectedId, select } = useUi();
  const items = useInbox((s) => s.items);
  const markRead = useInbox((s) => s.setState);
  const visible = filterBySection(items, section);
  const [groupBy, setGroupBy] = useState<GroupKey>("none");
  useEffect(() => setGroupBy("none"), [section]);

  const groupOptions = SECTION_GROUPS[section] ?? ["none"];
  const activeGroup = groupOptions.includes(groupBy) ? groupBy : "none";
  const groups = groupItems(visible, activeGroup);
  // Flattened order for j/k navigation across group sections.
  const flat = groups.flatMap((g) => g.items);

  // j/k keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key !== "j" && e.key !== "k") return;
      e.preventDefault();
      const idx = flat.findIndex((n) => n.id === selectedId);
      const next =
        e.key === "j" ? Math.min(idx + 1, flat.length - 1) : Math.max(idx <= 0 ? 0 : idx - 1, 0);
      const item = flat[next];
      if (item) {
        select(item.id);
        if (item.state === "unread") markRead(item.id, "read");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selectedId, select, markRead]);

  const onSelect = (n: AppNotification) => {
    select(n.id);
    if (n.state === "unread") markRead(n.id, "read");
  };

  const [menu, setMenu] = useState<MenuState | null>(null);
  const openMenu = (n: AppNotification, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ n, x: e.clientX, y: e.clientY });
  };

  // Collapsed group keys (reset when the grouping dimension changes).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => setCollapsed({}), [activeGroup, section]);

  return (
    <section className="flex h-full w-95 shrink-0 flex-col border-r border-line bg-surface">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center px-4">
        <h1 className="text-[15px] font-semibold tracking-tight">{sectionTitles[section]}</h1>
        <span className="ml-2 text-xs text-ink-3 tabular-nums">{visible.length}</span>
        {section === "slack" ? <SlackAnalyzeIndicator /> : <SyncIndicator />}
      </header>

      {groupOptions.length > 1 && visible.length > 0 && (
        <div className="flex shrink-0 items-center px-3 pb-2">
          <GroupByControl value={activeGroup} options={groupOptions} onChange={setGroupBy} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {section === "slack" && <SlackOverview />}
        {visible.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => {
              const grouped = activeGroup !== "none";
              const isCollapsed = grouped && collapsed[g.key];
              return (
                <div key={g.key}>
                  {g.label && (
                    <button
                      onClick={() =>
                        setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))
                      }
                      className="mb-1.5 flex w-full cursor-default items-center gap-1.5 px-1.5 text-left"
                    >
                      <ChevronDown
                        size={12}
                        className={cn(
                          "shrink-0 text-ink-3 transition-transform duration-150",
                          isCollapsed && "-rotate-90",
                        )}
                      />
                      <h2 className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                        {g.label}
                      </h2>
                      <span className="text-[11px] text-ink-3 tabular-nums">{g.items.length}</span>
                    </button>
                  )}
                  {!isCollapsed && (
                    <ul className="flex flex-col gap-1.5">
                      {g.items.map((n) => (
                        <NotificationCard
                          key={n.id}
                          n={n}
                          selected={n.id === selectedId}
                          onSelect={() => onSelect(n)}
                          onOpenMenu={(e) => openMenu(n, e)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {menu && <CardContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

function GroupByControl({
  value,
  options,
  onChange,
}: {
  value: GroupKey;
  options: GroupKey[];
  onChange: (k: GroupKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-7 cursor-default items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
          value !== "none"
            ? "border-accent/30 bg-accent-soft text-accent"
            : "border-line bg-surface-2 text-ink-2 hover:border-line-strong",
        )}
      >
        <Layers size={13} />
        {value === "none" ? "Group" : GROUP_LABELS[value]}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="animate-pop-in absolute top-8 left-0 z-30 w-40 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-pop">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={cn(
                "flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
                value === opt ? "text-accent" : "text-ink-2 hover:bg-surface-3",
              )}
            >
              <Check size={13} className={cn("shrink-0", value !== opt && "opacity-0")} />
              {GROUP_LABELS[opt]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationCard({
  n,
  selected,
  onSelect,
  onOpenMenu,
}: {
  n: AppNotification;
  selected: boolean;
  onSelect: () => void;
  onOpenMenu: (e: React.MouseEvent) => void;
}) {
  const run = useAgents((s) => s.runs[n.id]);
  return (
    <li>
      <div
        onClick={onSelect}
        onDoubleClick={onOpenMenu}
        onContextMenu={onOpenMenu}
        className={cn(
          "w-full cursor-default rounded-card border p-3 text-left transition-all duration-150",
          selected
            ? "border-accent bg-surface-2 shadow-card"
            : "border-transparent bg-surface-2/60 hover:border-line-strong hover:bg-surface-2",
        )}
      >
        <div className="flex items-start gap-2.5">
          <SourceBadge source={n.source} size={14} n={n} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px] leading-5",
                  n.state === "unread" ? "font-semibold text-ink" : "font-medium text-ink-2",
                )}
              >
                {n.title}
              </h3>
              {n.state === "unread" && <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-4.5 text-ink-3">{n.snippet}</p>
            <div className="mt-2 flex items-center gap-1.5">
              {n.relevance?.kind === "implicit" && (
                <Chip tone="ai">
                  <Sparkles size={10} />
                  AI: relevant to you
                </Chip>
              )}
              {n.meta?.ci === "failing" && <Chip tone="danger">CI failing</Chip>}
              {n.meta?.priority === "Urgent" && <Chip tone="warning">Urgent</Chip>}
              <span className="ml-auto text-[11px] text-ink-3">{relativeTime(n.createdAt)}</span>
            </div>
            {run && <AgentStatusRow run={run} />}
          </div>
        </div>
      </div>
    </li>
  );
}

function CardContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const { n, x, y } = menu;
  const launch = useAgents((s) => s.launch);
  const setState = useInbox((s) => s.setState);
  const select = useUi((s) => s.select);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const action = defaultAction(n.type);
  const canRunAgent = !!n.meta?.repo;
  const items: { icon: typeof Bot; label: string; run: () => void; disabled?: boolean; danger?: boolean }[] = [
    {
      icon: Bot,
      label: `${action} — Claude`,
      run: () => void launch(n, action, "claude"),
      disabled: !canRunAgent,
    },
    {
      icon: TerminalSquare,
      label: `${action} — Orca`,
      run: () => void launch(n, action, "orca"),
      disabled: !canRunAgent,
    },
    {
      icon: Eye,
      label: n.state === "unread" ? "Mark as read" : "Mark as unread",
      run: () => setState(n.id, n.state === "unread" ? "read" : "unread"),
    },
    { icon: ExternalLink, label: "Open", run: () => void openUrl(n.url), disabled: !n.url },
    {
      icon: CircleDot,
      label: "Mark done",
      run: () => {
        setState(n.id, "done");
        select(null);
      },
    },
  ];

  // Keep the menu on-screen.
  const top = Math.min(y, window.innerHeight - items.length * 34 - 16);
  const left = Math.min(x, window.innerWidth - 240);

  return (
    <div
      ref={ref}
      style={{ top, left }}
      className="animate-pop-in fixed z-50 w-56 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-pop"
    >
      {items.map((it) => (
        <button
          key={it.label}
          disabled={it.disabled}
          onClick={() => {
            it.run();
            onClose();
          }}
          className={cn(
            "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
            it.disabled ? "opacity-40" : it.danger ? "text-danger hover:bg-danger/10" : "text-ink-2 hover:bg-surface-3",
          )}
        >
          <it.icon size={14} className="shrink-0" />
          {it.label}
        </button>
      ))}
    </div>
  );
}

function SlackAnalyzeIndicator() {
  const { running, enabled, lastSyncAt, sync } = useSlackAi();
  if (running) {
    return (
      <div className="ml-auto flex items-center gap-1.5">
        <Loader2 size={13} className="animate-spin text-src-agent" />
        <span className="text-[11px] font-medium text-src-agent">Analyzing Slack…</span>
      </div>
    );
  }
  return (
    <div className="ml-auto flex items-center gap-1">
      {lastSyncAt && <span className="text-[11px] text-ink-3">Analyzed {relativeTime(lastSyncAt)}</span>}
      <IconButton label="Analyze Slack now" onClick={() => void sync()} disabled={!enabled}>
        <Sparkles size={14} />
      </IconButton>
    </div>
  );
}

function SyncIndicator() {
  const { lastSyncAt, syncing, sync, lastError } = useSync();
  return (
    <div className="ml-auto flex items-center gap-1">
      {lastError && !syncing && (
        <span title={lastError} className="text-[11px] text-danger">
          Sync issue
        </span>
      )}
      {lastSyncAt && !syncing && !lastError && (
        <span className="text-[11px] text-ink-3">Updated {relativeTime(lastSyncAt)}</span>
      )}
      {syncing && <span className="text-[11px] text-ink-3">Refreshing…</span>}
      <IconButton label="Refresh" onClick={() => void sync()} disabled={syncing}>
        <RefreshCw size={14} className={cn(syncing && "animate-spin")} />
      </IconButton>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-3">
      <InboxIcon size={28} strokeWidth={1.5} />
      <p className="text-[13px] font-medium">All clear</p>
      <p className="text-xs">Nothing needs your attention here.</p>
    </div>
  );
}
