import { useEffect, useRef, useState } from "react";
import { Sparkles, InboxIcon, RefreshCw, Layers, ChevronDown, Check } from "lucide-react";
import { useInbox, filterBySection } from "../../stores/inbox";
import { useUi } from "../../stores/ui";
import { useSync } from "../../stores/sync";
import type { AppNotification, SectionId } from "../../lib/types";
import { cn, relativeTime } from "../../lib/utils";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { Chip } from "../../components/ui/Chip";
import { IconButton } from "../../components/ui/IconButton";

const sectionTitles: Record<SectionId, string> = {
  inbox: "Inbox",
  prs: "Pull Requests",
  slack: "Slack",
  tickets: "Tickets",
  calendar: "Calendar",
  agents: "Agents",
  settings: "Settings",
};

type GroupKey = "none" | "status" | "priority" | "project" | "lead" | "cycle" | "team";

// Which notification meta field each grouping reads.
const GROUP_FIELD: Record<Exclude<GroupKey, "none">, string> = {
  status: "state",
  priority: "priority",
  project: "project",
  lead: "lead",
  cycle: "cycle",
  team: "team",
};

const GROUP_LABELS: Record<GroupKey, string> = {
  none: "No grouping",
  status: "Status",
  priority: "Priority",
  project: "Project",
  lead: "Lead",
  cycle: "Cycle",
  team: "Team",
};

interface Group {
  key: string;
  label: string;
  items: AppNotification[];
}

function groupItems(items: AppNotification[], by: GroupKey): Group[] {
  if (by === "none") return [{ key: "all", label: "", items }];
  const field = GROUP_FIELD[by];
  const order: string[] = [];
  const map = new Map<string, AppNotification[]>();
  for (const n of items) {
    const label = n.meta?.[field] ?? `No ${GROUP_LABELS[by].toLowerCase()}`;
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

  const activeGroup = section === "tickets" ? groupBy : "none";
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

  return (
    <section className="flex h-full w-95 shrink-0 flex-col border-r border-line bg-surface">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center px-4">
        <h1 className="text-[15px] font-semibold tracking-tight">{sectionTitles[section]}</h1>
        <span className="ml-2 text-xs text-ink-3 tabular-nums">{visible.length}</span>
        <SyncIndicator />
      </header>

      {section === "tickets" && visible.length > 0 && (
        <div className="flex shrink-0 items-center px-3 pb-2">
          <GroupByControl value={groupBy} onChange={setGroupBy} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {visible.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <div key={g.key}>
                {g.label && (
                  <div className="flex items-center gap-2 px-1.5 pb-1.5">
                    <h2 className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                      {g.label}
                    </h2>
                    <span className="text-[11px] text-ink-3 tabular-nums">{g.items.length}</span>
                  </div>
                )}
                <ul className="flex flex-col gap-1.5">
                  {g.items.map((n) => (
                    <NotificationCard
                      key={n.id}
                      n={n}
                      selected={n.id === selectedId}
                      onSelect={() => onSelect(n)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function GroupByControl({ value, onChange }: { value: GroupKey; onChange: (k: GroupKey) => void }) {
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

  const options: GroupKey[] = ["none", "status", "priority", "project", "lead", "cycle", "team"];

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
}: {
  n: AppNotification;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={cn(
          "w-full cursor-default rounded-card border p-3 text-left transition-all duration-150",
          selected
            ? "border-accent bg-surface-2 shadow-card"
            : "border-transparent bg-surface-2/60 hover:border-line-strong hover:bg-surface-2",
        )}
      >
        <div className="flex items-start gap-2.5">
          <SourceBadge source={n.source} size={14} />
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
          </div>
        </div>
      </button>
    </li>
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
