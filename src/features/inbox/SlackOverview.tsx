import { useState } from "react";
import { Sparkles, Sun, CalendarDays, Loader2 } from "lucide-react";
import { useSlackAi } from "../../stores/slackAi";
import { cn, relativeTime } from "../../lib/utils";

/**
 * Slack section overview: Claude-generated summaries of the last 24h and the
 * last 7 days, shown above the actionable items.
 */
export function SlackOverview() {
  const { enabled, running, daySummary, weekSummary, lastSyncAt, lastError } = useSlackAi();
  const [tab, setTab] = useState<"day" | "week">("day");

  if (!enabled) return null;

  const summary = tab === "day" ? daySummary : weekSummary;
  const hasAny = daySummary || weekSummary;

  return (
    <div className="mx-2.5 mb-2 rounded-card border border-line bg-surface-2 shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Sparkles size={13} className="text-src-agent" />
        <span className="text-[12px] font-semibold">Slack summary</span>
        <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5">
          <TabButton icon={Sun} label="Today" active={tab === "day"} onClick={() => setTab("day")} />
          <TabButton
            icon={CalendarDays}
            label="Week"
            active={tab === "week"}
            onClick={() => setTab("week")}
          />
        </div>
      </div>
      <div className="px-3 py-2.5">
        {running && !hasAny ? (
          <div className="flex items-center gap-2 py-1 text-[13px] text-src-agent">
            <Loader2 size={13} className="animate-spin" />
            Generating your Slack summary…
          </div>
        ) : summary ? (
          <p className="text-[13px] leading-5.5 whitespace-pre-wrap text-ink-2 select-text">{summary}</p>
        ) : lastError ? (
          <p className="text-[13px] text-danger">{lastError}</p>
        ) : (
          <p className="text-[13px] text-ink-3">
            No summary yet — an analysis round will generate one.
          </p>
        )}
        {lastSyncAt && (
          <p className="mt-2 text-[11px] text-ink-3">Updated {relativeTime(lastSyncAt)}</p>
        )}
      </div>
    </div>
  );
}

function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Sun;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex cursor-default items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-surface-2 text-ink shadow-sm" : "text-ink-3 hover:text-ink",
      )}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}
