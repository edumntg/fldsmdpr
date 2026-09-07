import { Calendar, ExternalLink, Flame, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useInbox } from "../../stores/inbox";
import { useUi } from "../../stores/ui";
import type { AppNotification, Source } from "../../lib/types";
import { SourceBadge, sourceLabel } from "../../components/ui/SourceBadge";
import { relativeTime, cn } from "../../lib/utils";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const isToday = (ms: number) => new Date(ms).toDateString() === new Date().toDateString();

/** Explicitly flagged as high priority at the source (Linear priority field,
 * Slack tasks claude judged urgent) — these jump the date ordering. */
const isHighPriority = (n: AppNotification) => {
  const p = n.meta?.priority?.toLowerCase();
  return p === "urgent" || p === "high";
};

const PAGE_SIZE = 10;

async function openUrl(url?: string) {
  if (!url) return;
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl: open } = await import("@tauri-apps/plugin-opener");
    await open(url);
  } else {
    window.open(url, "_blank");
  }
}

/** Morning-briefing view: today's agenda + the highest-priority actionables. */
export function TodayView() {
  const items = useInbox((s) => s.items);
  const setSection = useUi((s) => s.setSection);
  const select = useUi((s) => s.select);
  const [page, setPage] = useState(0);

  const active = items.filter((n) => n.state !== "done");
  const agenda = active
    .filter((n) => n.source === "gcal" && isToday(n.createdAt))
    .sort((a, b) => a.createdAt - b.createdAt);
  // Newest first, but anything the source marked high-priority jumps the queue.
  const allActionables = active
    .filter((n) => n.source !== "gcal")
    .sort(
      (a, b) =>
        Number(isHighPriority(b)) - Number(isHighPriority(a)) || b.createdAt - a.createdAt,
    );
  const pageCount = Math.max(1, Math.ceil(allActionables.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const actionables = allActionables.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const counts = new Map<Source, number>();
  for (const n of active) counts.set(n.source, (counts.get(n.source) ?? 0) + 1);

  const goTo = (n: AppNotification) => {
    setSection("inbox");
    select(n.id);
  };

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center px-5">
        <h1 className="text-[15px] font-semibold tracking-tight">Today</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5 pt-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-6">
          <div className="animate-pop-in">
            <h2 className="text-[22px] font-semibold tracking-tight">{greeting()}</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{dateLabel}</p>
          </div>

          {/* per-source counts — jump straight into a section */}
          <div className="flex flex-wrap gap-2">
            {[...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([source, count]) => (
                <button
                  key={source}
                  onClick={() => setSection(sectionFor(source))}
                  className="flex cursor-default items-center gap-2 rounded-xl border border-line bg-surface-2 py-1.5 pr-3 pl-1.5 shadow-card transition-colors hover:border-line-strong"
                >
                  <SourceBadge source={source} size={13} />
                  <span className="text-[13px] font-semibold tabular-nums">{count}</span>
                  <span className="text-xs text-ink-3">{sourceLabel(source)}</span>
                </button>
              ))}
            {counts.size === 0 && (
              <p className="text-[13px] text-ink-3">Nothing pending — connect sources in Settings.</p>
            )}
          </div>

          <Card title="Today's agenda" icon={Calendar}>
            {agenda.length === 0 ? (
              <p className="text-[13px] text-ink-3">No events today.</p>
            ) : (
              <div className="flex flex-col">
                {agenda.map((n, i) => (
                  <div
                    key={n.id}
                    className={cn(
                      "flex items-center gap-3 py-2",
                      i > 0 && "border-t border-line",
                    )}
                  >
                    <span className="w-20 shrink-0 font-mono text-xs text-ink-3">
                      {new Date(n.createdAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{n.title}</span>
                    <span className="shrink-0 text-xs text-ink-3">{relativeTime(n.createdAt)}</span>
                    {(n.meta?.link ?? n.url) && (
                      <button
                        onClick={() => void openUrl(n.meta?.link ?? n.url)}
                        className="inline-flex shrink-0 cursor-default items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
                      >
                        <ExternalLink size={11} />
                        Join
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Top of your list" icon={Flame}>
            {actionables.length === 0 ? (
              <p className="text-[13px] text-ink-3">All clear — nothing waiting on you.</p>
            ) : (
              <div className="flex flex-col">
                {actionables.map((n, i) => (
                  <button
                    key={n.id}
                    onClick={() => goTo(n)}
                    className={cn(
                      "group flex cursor-default items-center gap-3 py-2 text-left",
                      i > 0 && "border-t border-line",
                    )}
                  >
                    <SourceBadge source={n.source} size={13} n={n} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {isHighPriority(n) && (
                          <span className="shrink-0 rounded-pill bg-danger/10 px-1.5 py-px text-[10px] font-semibold text-danger">
                            {n.meta?.priority}
                          </span>
                        )}
                        <span
                          className={cn(
                            "truncate text-[13px]",
                            n.state === "unread" ? "font-semibold" : "font-medium text-ink-2",
                          )}
                        >
                          {n.title}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-ink-3">{n.snippet}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">{relativeTime(n.createdAt)}</span>
                    <ArrowRight
                      size={13}
                      className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </button>
                ))}
                {pageCount > 1 && (
                  <div className="flex items-center justify-between border-t border-line pt-2.5">
                    <button
                      onClick={() => setPage(Math.max(0, safePage - 1))}
                      disabled={safePage === 0}
                      className={cn(
                        "inline-flex cursor-default items-center gap-1 text-xs font-medium",
                        safePage === 0 ? "text-ink-3" : "text-accent hover:underline",
                      )}
                    >
                      <ChevronLeft size={13} />
                      Previous
                    </button>
                    <span className="text-xs text-ink-3">
                      {safePage + 1} / {pageCount} · {allActionables.length} items
                    </span>
                    <button
                      onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                      disabled={safePage >= pageCount - 1}
                      className={cn(
                        "inline-flex cursor-default items-center gap-1 text-xs font-medium",
                        safePage >= pageCount - 1 ? "text-ink-3" : "text-accent hover:underline",
                      )}
                    >
                      Next
                      <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}

function sectionFor(source: Source) {
  switch (source) {
    case "github":
      return "prs" as const;
    case "slack":
      return "slack" as const;
    case "linear":
      return "tickets" as const;
    case "sentry":
      return "errors" as const;
    case "granola":
      return "meetings" as const;
    case "gcal":
      return "calendar" as const;
    default:
      return "inbox" as const;
  }
}

function Card({ title, icon: Icon, children }: { title: string; icon: typeof Calendar; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface-2 p-5 shadow-card">
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold">
        <Icon size={14} className="text-ink-3" />
        {title}
      </h3>
      {children}
    </div>
  );
}
