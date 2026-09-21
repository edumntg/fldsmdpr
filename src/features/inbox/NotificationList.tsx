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
  Search,
  X,
  Pin,
  Link2,
  FileText,
  Clock,
  CheckCheck,
  MailOpen,
  ArrowDownWideNarrow,
  CalendarClock,
  Plug,
  MessageCircleQuestion,
  Flame,
  CalendarRange,
  Loader2,
  UserCheck,
} from "lucide-react";
import { useInbox, filterBySection, isPinned, inRange, notMine } from "../../stores/inbox";
import { useUi } from "../../stores/ui";
import { useSync } from "../../stores/sync";
import { useAgents } from "../../stores/agents";
import { useConnections } from "../../stores/connections";
import { useAiSources } from "../../stores/aiSources";
import { useSlackAi } from "../../stores/slackAi";
import { SlackOverview } from "./SlackOverview";
import type { AppNotification, SectionId, Source } from "../../lib/types";
import { cn, relativeTime, useTick, isTyping } from "../../lib/utils";
import { usePaneSize } from "../../lib/usePaneSize";
import { SourceBadge, sourceLabel } from "../../components/ui/SourceBadge";
import { Chip } from "../../components/ui/Chip";
import { IconButton } from "../../components/ui/IconButton";
import { CardSkeleton } from "../../components/ui/Skeleton";
import { AgentStatusRow } from "../agents/AgentStatusRow";
import { LinearStateChip } from "../../components/ui/LinearStateChip";
import { SlackPills } from "../../components/ui/SlackPills";
import { SECTION_LABELS } from "../../components/layout/Sidebar";
import { Button } from "../../components/ui/Button";
import {
  markDone,
  toggleRead,
  togglePin,
  snooze,
  copyLink,
  copyMarkdown,
  openItem,
  askAbout,
  defaultAction,
  JEV_URGENCY_LABEL,
  SNOOZE_OPTIONS,
} from "../../lib/actions";
import { RANGE_LABELS, type Range } from "../../stores/ui";

interface MenuState {
  n: AppNotification;
  x: number;
  y: number;
}

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
  errors: ["none", "project"],
};

/** Which connection feeds a section — drives the "Connect X" empty state. */
const SECTION_PROVIDER: Partial<Record<SectionId, { source: Source; name: string }>> = {
  prs: { source: "github", name: "GitHub" },
  tickets: { source: "linear", name: "Linear" },
  errors: { source: "sentry", name: "Sentry" },
  calendar: { source: "gcal", name: "a calendar" },
  meetings: { source: "granola", name: "Granola" },
  slack: { source: "slack", name: "Slack" },
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
    case "incident":
      return "Incidents";
    case "action_item":
      return "Action items";
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
  const section = useUi((s) => s.section);
  const selectedId = useUi((s) => s.selectedId);
  const select = useUi((s) => s.select);
  const unreadOnly = useUi((s) => s.unreadOnly);
  const toggleUnreadOnly = useUi((s) => s.toggleUnreadOnly);
  const sortBy = useUi((s) => s.sortBy);
  const toggleSort = useUi((s) => s.toggleSort);
  const range = useUi((s) => s.range);
  const setRange = useUi((s) => s.setRange);
  const showSentry = useUi((s) => s.showSentry);
  const toggleSentry = useUi((s) => s.toggleSentry);
  const onlyMine = useUi((s) => s.onlyMine);
  const toggleOnlyMine = useUi((s) => s.toggleOnlyMine);
  const items = useInbox((s) => s.items);
  const loaded = useInbox((s) => s.loaded);
  const setState = useInbox((s) => s.setState);
  const markRead = useInbox((s) => s.markRead);
  const [groupBy, setGroupBy] = useState<GroupKey>("none");
  const [query, setQuery] = useState("");
  const [listWidth, startListDrag] = usePaneSize("inbox-list", 380, 300, 680);
  useTick();
  useEffect(() => {
    setGroupBy("none");
    setQuery("");
  }, [section]);

  // Free-text filter over everything visible on a card: title, snippet,
  // author, repo, project… (every meta value counts).
  const sectionItems = filterBySection(items, section, sortBy, showSentry);
  const q = query.trim().toLowerCase();
  const visible = sectionItems.filter(
    (n) =>
      inRange(n, range) &&
      !(onlyMine && notMine(n)) &&
      (!unreadOnly || n.state === "unread") &&
      (!q ||
        [n.title, n.snippet, sourceLabel(n.source), ...Object.values(n.meta ?? {})]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  const unreadVisible = visible.filter((n) => n.state === "unread");

  const groupOptions = SECTION_GROUPS[section] ?? ["none"];
  const activeGroup = groupOptions.includes(groupBy) ? groupBy : "none";
  const groups = groupItems(visible, activeGroup);

  // Collapsed group keys (reset when the grouping dimension changes).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => setCollapsed({}), [activeGroup, section]);

  // Flattened order for j/k navigation — skipping collapsed groups, so the
  // keyboard never selects (and marks read) items that aren't visible.
  const flat = groups.flatMap((g) => (activeGroup !== "none" && collapsed[g.key] ? [] : g.items));

  // j/k keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (e.key !== "j" && e.key !== "k") return;
      e.preventDefault();
      const idx = flat.findIndex((n) => n.id === selectedId);
      const next =
        e.key === "j" ? Math.min(idx + 1, flat.length - 1) : Math.max(idx <= 0 ? 0 : idx - 1, 0);
      const item = flat[next];
      if (item) {
        select(item.id);
        if (item.state === "unread") setState(item.id, "read");
        document.getElementById(`card-${item.id}`)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selectedId, select, setState]);

  const onSelect = (n: AppNotification) => {
    select(n.id);
    if (n.state === "unread") setState(n.id, "read");
  };

  const [menu, setMenu] = useState<MenuState | null>(null);
  const openMenu = (n: AppNotification, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ n, x: e.clientX, y: e.clientY });
  };

  return (
    <section
      style={{ width: listWidth }}
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-surface"
    >
      {/* drag handle: resize the list pane width */}
      <div
        onMouseDown={(e) => startListDrag(e, "x", 1)}
        className="absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-accent/30"
      />

      <div className="flex-1 overflow-y-auto pb-3">
        {/* frosted, sticky header: title + counters + actions, then the filter row */}
        <div className="glass sticky top-0 z-10">
          <header data-tauri-drag-region className="flex h-13 shrink-0 items-center px-4">
            <h1 className="text-[15px] font-semibold tracking-tight">{SECTION_LABELS[section]}</h1>
            <span className="ml-2 text-xs text-ink-3 tabular-nums">{visible.length}</span>
            <div className="ml-auto flex items-center gap-0.5">
              {section === "inbox" && (
                <IconButton
                  label={showSentry ? "Hiding Sentry errors" : "Show Sentry errors here"}
                  onClick={toggleSentry}
                  className={cn(showSentry && "bg-src-sentry/12 text-src-sentry hover:bg-src-sentry/12 hover:text-src-sentry")}
                >
                  <Flame size={15} />
                </IconButton>
              )}
              <IconButton
                label={onlyMine ? "Showing only items about you" : "Only items about you"}
                onClick={toggleOnlyMine}
                className={cn(onlyMine && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent")}
              >
                <UserCheck size={15} />
              </IconButton>
              {unreadVisible.length > 0 && (
                <IconButton
                  label={`Mark ${unreadVisible.length} as read`}
                  onClick={() => markRead(unreadVisible.map((n) => n.id))}
                >
                  <CheckCheck size={15} />
                </IconButton>
              )}
              <IconButton
                label={unreadOnly ? "Showing unread only" : "Show unread only"}
                onClick={toggleUnreadOnly}
                className={cn(unreadOnly && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent")}
              >
                <MailOpen size={15} />
              </IconButton>
              <IconButton
                label={sortBy === "priority" ? "Sorted by priority" : "Sorted by newest"}
                onClick={toggleSort}
              >
                {sortBy === "priority" ? <ArrowDownWideNarrow size={15} /> : <CalendarClock size={15} />}
              </IconButton>
              {section === "slack" ? <SlackAnalyzeIndicator /> : <SyncIndicator />}
            </div>
          </header>

          {(sectionItems.length > 0 || q) && (
            <div className="flex shrink-0 items-center gap-2 px-3 pb-2.5">
              <div className="relative min-w-0 flex-1">
                <Search size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
                <input
                  id="list-filter"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuery("");
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="Filter by title, author, repo…  ⌘F"
                  className="h-7.5 w-full rounded-xl border border-line bg-surface-2 pr-7 pl-7.5 text-xs text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    aria-label="Clear filter"
                    className="absolute top-1/2 right-2 -translate-y-1/2 cursor-default text-ink-3 hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <RangeControl value={range} onChange={setRange} />
              {groupOptions.length > 1 && (
                <GroupByControl value={activeGroup} options={groupOptions} onChange={setGroupBy} />
              )}
            </div>
          )}
        </div>

        <div className="px-2.5">
          {section === "slack" && <SlackOverview />}
          {!loaded && items.length === 0 ? (
            <div className="stagger flex flex-col gap-[var(--card-gap)]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ "--i": i } as React.CSSProperties}>
                  <CardSkeleton />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            q || unreadOnly || range !== "all" || onlyMine ? (
              <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-[13px] text-ink-3">
                <p>
                  {q
                    ? `No items match “${query.trim()}”.`
                    : unreadOnly
                      ? "No unread items here."
                      : onlyMine && range === "all"
                        ? "Nothing here is about you."
                        : `Nothing from ${RANGE_LABELS[range].toLowerCase()}.`}
                </p>
                {unreadOnly && (
                  <Button size="sm" variant="ghost" onClick={toggleUnreadOnly}>
                    Show all
                  </Button>
                )}
                {!unreadOnly && range !== "all" && (
                  <Button size="sm" variant="ghost" onClick={() => setRange("all")}>
                    Show all time
                  </Button>
                )}
                {!unreadOnly && range === "all" && onlyMine && (
                  <Button size="sm" variant="ghost" onClick={toggleOnlyMine}>
                    Show everything
                  </Button>
                )}
              </div>
            ) : (
              <EmptyState section={section} />
            )
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((g) => {
                const grouped = activeGroup !== "none";
                const isCollapsed = grouped && collapsed[g.key];
                return (
                  <div key={g.key}>
                    {g.label && (
                      <button
                        onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                        className="press mb-1.5 flex w-full cursor-default items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left hover:bg-surface-3/60"
                      >
                        <ChevronDown
                          size={12}
                          className={cn(
                            "shrink-0 text-ink-3 transition-transform duration-150",
                            isCollapsed && "-rotate-90",
                          )}
                        />
                        <h2 className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">{g.label}</h2>
                        <span className="text-[11px] text-ink-3 tabular-nums">{g.items.length}</span>
                      </button>
                    )}
                    {!isCollapsed && (
                      <ul className="stagger flex flex-col gap-[var(--card-gap)]">
                        {g.items.map((n, i) => (
                          <NotificationCard
                            key={n.id}
                            n={n}
                            index={i}
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
      </div>

      {menu && <CardContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

const RANGES: Range[] = ["all", "today", "3d", "7d"];

function RangeControl({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
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
        title="Time range"
        className={cn(
          "press inline-flex h-7 cursor-default items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium",
          value !== "all"
            ? "border-accent/30 bg-accent-soft text-accent"
            : "border-line bg-surface-2 text-ink-2 hover:border-line-strong",
        )}
      >
        <CalendarRange size={13} />
        {RANGE_LABELS[value]}
        <ChevronDown size={12} className={cn("transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <div className="animate-pop-in absolute top-8 left-0 z-30 w-36 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-pop">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={cn(
                "flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
                value === r ? "text-accent" : "text-ink-2 hover:bg-surface-3",
              )}
            >
              <Check size={13} className={cn("shrink-0", value !== r && "opacity-0")} />
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </div>
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
          "press inline-flex h-7 cursor-default items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium",
          value !== "none"
            ? "border-accent/30 bg-accent-soft text-accent"
            : "border-line bg-surface-2 text-ink-2 hover:border-line-strong",
        )}
      >
        <Layers size={13} />
        {value === "none" ? "Group" : GROUP_LABELS[value]}
        <ChevronDown size={12} className={cn("transition-transform duration-150", open && "rotate-180")} />
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
  index,
  selected,
  onSelect,
  onOpenMenu,
}: {
  n: AppNotification;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onOpenMenu: (e: React.MouseEvent) => void;
}) {
  const run = useAgents((s) => s.runs[n.id]);
  const pinned = isPinned(n);
  return (
    <li id={`card-${n.id}`} style={{ "--i": index } as React.CSSProperties}>
      <div
        onClick={onSelect}
        onDoubleClick={onOpenMenu}
        onContextMenu={onOpenMenu}
        className={cn(
          "press w-full cursor-default rounded-card border p-[var(--card-pad)] text-left",
          selected
            ? "border-accent bg-surface-2 shadow-card ring-2 ring-accent/15"
            : "border-transparent bg-surface-2/60 hover:-translate-y-px hover:border-line-strong hover:bg-surface-2 hover:shadow-card-hover",
        )}
      >
        <div className="flex items-start gap-2.5">
          <SourceBadge source={n.source} size={14} n={n} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {pinned && <Pin size={11} className="shrink-0 fill-current text-accent" />}
              <h3
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px] leading-5",
                  n.state === "unread" ? "font-semibold text-ink" : "font-medium text-ink-2",
                )}
              >
                {n.title}
              </h3>
              {n.state === "unread" && (
                <span className="animate-pulse-dot size-1.5 shrink-0 rounded-full bg-accent" />
              )}
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
              <SlackPills n={n} compact />
              {n.source === "linear" && <LinearStateChip n={n} />}
              {n.meta?.priority === "Urgent" && n.meta?.jev_urgency !== "urgent" && <Chip tone="warning">Urgent</Chip>}
              {(n.meta?.jev_urgency === "urgent" || n.meta?.jev_urgency === "today") && n.meta?.jev_priority && (
                <Chip tone={n.meta.jev_urgency === "urgent" ? "danger" : "ai"} className="gap-1">
                  <Sparkles size={10} />
                  {JEV_URGENCY_LABEL[n.meta.jev_urgency]}
                </Chip>
              )}
              {n.source === "linear" && n.meta?.cycle && (
                <span className="text-[11px] text-ink-3">{n.meta.cycle}</span>
              )}
              <span className="ml-auto text-[11px] text-ink-3 tabular-nums">{relativeTime(n.createdAt)}</span>
            </div>
            {run && <AgentStatusRow run={run} />}
          </div>
        </div>
      </div>
    </li>
  );
}

type MenuItem =
  | { icon: typeof Bot; label: string; run: () => void; disabled?: boolean; danger?: boolean }
  | { separator: true };

function CardContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const { n, x, y } = menu;
  const launch = useAgents((s) => s.launch);
  const ref = useRef<HTMLDivElement>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

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

  const action = defaultAction(n) ?? "Run agent on this";
  const canRunAgent = !!n.meta?.repo;
  const items: MenuItem[] = [
    { icon: Bot, label: `${action} — Claude`, run: () => void launch(n, action, "claude"), disabled: !canRunAgent },
    { icon: TerminalSquare, label: `${action} — Orca`, run: () => void launch(n, action, "orca"), disabled: !canRunAgent },
    { icon: MessageCircleQuestion, label: "Ask about this", run: () => askAbout(n) },
    { separator: true },
    { icon: Pin, label: isPinned(n) ? "Unpin" : "Pin to top", run: () => togglePin(n) },
    { icon: Eye, label: n.state === "unread" ? "Mark as read" : "Mark as unread", run: () => toggleRead(n) },
    { icon: Clock, label: "Snooze…", run: () => setSnoozeOpen(true) },
    { separator: true },
    { icon: ExternalLink, label: "Open", run: () => openItem(n), disabled: !n.url },
    { icon: Link2, label: "Copy link", run: () => void copyLink(n), disabled: !n.url },
    { icon: FileText, label: "Copy as Markdown", run: () => void copyMarkdown(n) },
    { separator: true },
    { icon: CircleDot, label: "Mark done", run: () => markDone(n) },
  ];

  // Keep the menu on-screen.
  const top = Math.min(y, window.innerHeight - items.length * 32 - 24);
  const left = Math.min(x, window.innerWidth - 240);

  return (
    <div
      ref={ref}
      style={{ top, left }}
      className="animate-pop-in fixed z-50 w-56 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-pop"
    >
      {snoozeOpen
        ? SNOOZE_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => {
                void snooze(n, o.until(), o.label);
                onClose();
              }}
              className="flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-3"
            >
              <Clock size={13} className="shrink-0 text-ink-3" />
              {o.label}
            </button>
          ))
        : items.map((it, i) =>
            "separator" in it ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={it.label}
                disabled={it.disabled}
                onClick={() => {
                  it.run();
                  if (it.label !== "Snooze…") onClose();
                }}
                className={cn(
                  "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
                  it.disabled ? "opacity-40" : it.danger ? "text-danger hover:bg-danger/10" : "text-ink-2 hover:bg-surface-3",
                )}
              >
                <it.icon size={14} className="shrink-0" />
                {it.label}
              </button>
            ),
          )}
    </div>
  );
}

function SlackAnalyzeIndicator() {
  const { running, enabled, available, lastSyncAt, sync } = useSlackAi();
  if (running) {
    return (
      <div className="flex items-center gap-1.5 pr-1">
        <Loader2 size={13} className="animate-spin text-src-agent" />
        <span className="text-[11px] font-medium text-src-agent">Analyzing Slack…</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {lastSyncAt && <span className="text-[11px] text-ink-3">Analyzed {relativeTime(lastSyncAt)}</span>}
      <IconButton label="Analyze Slack now" onClick={() => void sync()} disabled={!enabled || !available}>
        <Sparkles size={14} />
      </IconButton>
    </div>
  );
}

function SyncIndicator() {
  const { lastSyncAt, syncing, sync, lastError } = useSync();
  return (
    <div className="flex items-center gap-1">
      {lastError && !syncing && (
        <span title={lastError} className="text-[11px] text-danger">
          Sync issue
        </span>
      )}
      {lastSyncAt && !syncing && !lastError && (
        <span className="hidden text-[11px] text-ink-3 min-[420px]:inline">{relativeTime(lastSyncAt)}</span>
      )}
      <IconButton label={syncing ? "Refreshing…" : "Refresh (⌘R)"} onClick={() => void sync()} disabled={syncing}>
        <RefreshCw size={14} className={cn(syncing && "animate-spin")} />
      </IconButton>
    </div>
  );
}

/** "All clear" — or, when the section's connector isn't set up yet, a nudge to connect it. */
function EmptyState({ section }: { section: SectionId }) {
  const statuses = useConnections((s) => s.statuses);
  const granolaEnabled = useAiSources((s) => s.sources.granola.enabled);
  const setSection = useUi((s) => s.setSection);
  const provider = SECTION_PROVIDER[section];
  const slackAvailable = useSlackAi((s) => s.available);
  const connected = !provider
    ? true
    : provider.source === "granola"
      ? granolaEnabled
      : provider.source === "slack"
        ? slackAvailable || statuses.some((s) => s.id === "slack" && s.connected)
        : statuses.some((s) => s.id === provider.source && s.connected);

  if (provider && !connected) {
    return (
      <div className="animate-enter flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Plug size={20} />
        </span>
        <div>
          <p className="text-[13px] font-medium text-ink">Connect {provider.name}</p>
          <p className="mt-0.5 text-xs text-ink-3">Nothing shows here until it's connected in Settings.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setSection("settings")}>
          Open Settings
        </Button>
      </div>
    );
  }
  return (
    <div className="animate-enter flex flex-col items-center justify-center gap-2 py-16 text-ink-3">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-success/10 text-success">
        <InboxIcon size={20} strokeWidth={1.75} />
      </span>
      <p className="text-[13px] font-medium text-ink">All clear</p>
      <p className="text-xs">Nothing needs your attention here.</p>
    </div>
  );
}
