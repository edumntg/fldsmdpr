import { useState } from "react";
import { Sparkles, Sun, CalendarDays, Loader2, Hash } from "lucide-react";
import { useSlackAi } from "../../stores/slackAi";
import { cn, relativeTime } from "../../lib/utils";
import { Collapsible } from "../../components/ui/Collapsible";
import { AgentQuickLaunch } from "../agents/AgentRunButton";
import type { AppNotification } from "../../lib/types";

interface SummaryItem {
  text: string;
  channel?: string;
  actionable?: boolean;
}

/** Stored summaries are JSON: an array of granular items (new runs) or a plain
 * prose string (older runs) — render both. */
function parseSummary(raw: string): SummaryItem[] | string | null {
  if (!raw || raw === "null" || raw === '""') return null;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((i) => i && typeof i.text === "string");
    if (typeof v === "string") return v.trim() ? v : null;
  } catch {
    return raw.trim() ? raw : null;
  }
  return null;
}

/** Synthetic notification so agent runs on a summary item are tracked/launched
 * exactly like regular notifications. */
function summaryNotification(item: SummaryItem, idx: number, scope: string): AppNotification {
  return {
    id: `slack-sum:${scope}:${idx}:${item.text.slice(0, 24)}`,
    source: "slack",
    type: "ai_inferred",
    title: item.text.slice(0, 80),
    snippet: item.text,
    createdAt: Date.now(),
    priority: 0,
    state: "read",
    meta: item.channel ? { channel: item.channel } : {},
  };
}

export function SlackOverview() {
  const { enabled, running, daySummary, weekSummary, lastSyncAt, lastError } = useSlackAi();
  const [tab, setTab] = useState<"day" | "week">("day");

  if (!enabled) return null;

  const parsed = parseSummary(tab === "day" ? daySummary : weekSummary);
  const hasAny = parseSummary(daySummary) || parseSummary(weekSummary);

  return (
    <div className="mb-2">
      <Collapsible
        defaultOpen
        className="bg-surface-2 shadow-card"
        title={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={12} className="text-src-agent" />
            Slack summary
            {running && <Loader2 size={11} className="animate-spin text-src-agent" />}
          </span>
        }
        badge={
          <span className="flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5">
            <TabButton icon={Sun} label="Today" active={tab === "day"} onClick={() => setTab("day")} />
            <TabButton
              icon={CalendarDays}
              label="Week"
              active={tab === "week"}
              onClick={() => setTab("week")}
            />
          </span>
        }
      >
        {running && !hasAny ? (
          <div className="flex items-center gap-2 py-1 text-[13px] text-src-agent">
            <Loader2 size={13} className="animate-spin" />
            Generating your Slack summary…
          </div>
        ) : Array.isArray(parsed) ? (
          <ul className="flex flex-col">
            {parsed.map((item, i) => (
              <li
                key={i}
                className="group flex items-start gap-2 border-b border-line py-2 first:pt-0.5 last:border-0 last:pb-0.5"
              >
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-3" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 text-ink-2 select-text">{item.text}</p>
                  {item.channel && (
                    <span className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-ink-3">
                      <Hash size={9} />
                      {item.channel.replace(/^#/, "")}
                    </span>
                  )}
                </div>
                {item.actionable && (
                  <AgentQuickLaunch
                    n={summaryNotification(item, i, tab)}
                    label="Run agent on this task"
                  />
                )}
              </li>
            ))}
          </ul>
        ) : typeof parsed === "string" ? (
          <p className="text-[13px] leading-5.5 whitespace-pre-wrap text-ink-2 select-text">{parsed}</p>
        ) : lastError ? (
          <p className="text-[13px] text-danger">{lastError}</p>
        ) : (
          <p className="text-[13px] text-ink-3">No summary yet — an analysis round will generate one.</p>
        )}
        {lastSyncAt && <p className="mt-2 text-[11px] text-ink-3">Updated {relativeTime(lastSyncAt)}</p>}
      </Collapsible>
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
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
