import { useEffect } from "react";
import { Sparkles, InboxIcon, RefreshCw } from "lucide-react";
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

export function NotificationList() {
  const { section, selectedId, select } = useUi();
  const items = useInbox((s) => s.items);
  const markRead = useInbox((s) => s.setState);
  const visible = filterBySection(items, section);

  // j/k keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key !== "j" && e.key !== "k") return;
      e.preventDefault();
      const idx = visible.findIndex((n) => n.id === selectedId);
      const next =
        e.key === "j" ? Math.min(idx + 1, visible.length - 1) : Math.max(idx <= 0 ? 0 : idx - 1, 0);
      const item = visible[next];
      if (item) {
        select(item.id);
        if (item.state === "unread") markRead(item.id, "read");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, select, markRead]);

  return (
    <section className="flex h-full w-95 shrink-0 flex-col border-r border-line bg-surface">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center px-4">
        <h1 className="text-[15px] font-semibold tracking-tight">{sectionTitles[section]}</h1>
        <span className="ml-2 text-xs text-ink-3 tabular-nums">{visible.length}</span>
        <SyncIndicator />
      </header>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {visible.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((n) => (
              <NotificationCard
                key={n.id}
                n={n}
                selected={n.id === selectedId}
                onSelect={() => {
                  select(n.id);
                  if (n.state === "unread") markRead(n.id, "read");
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
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
