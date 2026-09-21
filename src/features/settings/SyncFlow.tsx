import { useEffect, useState } from "react";
import { Inbox, Loader2 } from "lucide-react";
import type { Source } from "../../lib/types";
import { kvGet, maccalConfig } from "../../lib/ipc";
import { useSync } from "../../stores/sync";
import { useAiSources, type AiSource } from "../../stores/aiSources";
import { useConnections } from "../../stores/connections";
import { SourceBadge, sourceLabel } from "../../components/ui/SourceBadge";
import { cn, relativeTime } from "../../lib/utils";

const PROVIDERS: Source[] = ["github", "slack", "linear", "sentry", "gcal"];
const AI: AiSource[] = ["notion", "granola"];
const SOURCES: Source[] = [...PROVIDERS, ...AI];

// Fixed geometry so the connector SVG needs no measuring.
const NODE_H = 36;
const GAP = 8;
const PITCH = NODE_H + GAP;
const LINK_W = 56;
const HEIGHT = SOURCES.length * PITCH - GAP;
const MID = HEIGHT / 2;

const isAi = (s: Source): s is AiSource => s === "notion" || s === "granola";

/**
 * Sources → Inbox diagram. Each source node is a button that refreshes only
 * that connection (token providers via run_sync(only), AI sources via their
 * own claude round).
 */
export function SyncFlow() {
  const { sync, syncing, syncingSource, lastSyncAt } = useSync();
  const statuses = useConnections((s) => s.statuses);
  const ai = useAiSources((s) => s.sources);
  const aiSync = useAiSources((s) => s.sync);
  const [lastByProvider, setLastByProvider] = useState<Record<string, number | null>>({});
  const [calendarOn, setCalendarOn] = useState(false);

  // Per-provider timestamps are written by run_sync as `last_sync:<id>`.
  useEffect(() => {
    void Promise.all(PROVIDERS.map((p) => kvGet(`last_sync:${p}`))).then((vals) =>
      setLastByProvider(Object.fromEntries(PROVIDERS.map((p, i) => [p, vals[i] ? Number(vals[i]) : null]))),
    );
  }, [lastSyncAt]);
  useEffect(() => {
    void maccalConfig().then((c) => setCalendarOn(!!c?.enabled && c.calendars.length > 0));
  }, []);

  const connected = (s: Source) =>
    isAi(s)
      ? ai[s].enabled
      : (statuses.find((st) => st.id === s)?.connected ?? false) || (s === "gcal" && calendarOn);
  const running = (s: Source) => (isAi(s) ? ai[s].running : syncing && (syncingSource === s || syncingSource === null));
  const last = (s: Source) => (isAi(s) ? ai[s].lastSyncAt : lastByProvider[s] ?? null);
  const error = (s: Source) => (isAi(s) ? ai[s].lastError : null);
  const refresh = (s: Source) => (isAi(s) ? void aiSync(s) : void sync(s));

  return (
    <div className="flex items-stretch">
      <div className="flex flex-col" style={{ gap: GAP }}>
        {SOURCES.map((s) => {
          const on = connected(s);
          const busy = running(s);
          const err = error(s);
          return (
            <button
              key={s}
              onClick={() => refresh(s)}
              disabled={!on || busy}
              title={!on ? `${sourceLabel(s)} is not connected — set it up below` : err ? err : `Refresh ${sourceLabel(s)} now`}
              style={{ height: NODE_H }}
              className={cn(
                "flex w-56 cursor-default items-center gap-2 rounded-xl border px-2 text-left transition-colors",
                on ? "border-line bg-surface hover:border-accent hover:bg-accent-soft/40" : "border-dashed border-line opacity-60",
              )}
            >
              <SourceBadge source={s} size={12} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ink">{sourceLabel(s)}</span>
                <span className={cn("block truncate text-[10.5px]", err ? "text-danger" : "text-ink-3")}>
                  {!on ? "Not connected" : busy ? "Refreshing…" : err ? "Failed — click to retry" : last(s) ? relativeTime(last(s)!) : "Never"}
                </span>
              </span>
              {busy ? (
                <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
              ) : (
                <span className={cn("size-1.5 shrink-0 rounded-full", on ? (err ? "bg-danger" : "bg-success") : "bg-ink-3/40")} />
              )}
            </button>
          );
        })}
      </div>

      <svg width={LINK_W} height={HEIGHT} className="shrink-0 overflow-visible">
        {SOURCES.map((s, i) => {
          const y = i * PITCH + NODE_H / 2;
          const on = connected(s);
          return (
            <path
              key={s}
              d={`M0,${y} C${LINK_W / 2},${y} ${LINK_W / 2},${MID} ${LINK_W},${MID}`}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray={running(s) ? "4 4" : undefined}
              className={cn(
                on ? "stroke-accent/50" : "stroke-line",
                running(s) && "animate-[dash_1s_linear_infinite]",
              )}
            />
          );
        })}
      </svg>

      <div className="flex items-center">
        <div className="flex h-14 items-center gap-2.5 rounded-xl border border-accent/40 bg-accent-soft px-3.5">
          <Inbox size={16} className="text-accent" />
          <span>
            <span className="block text-[13px] font-semibold text-ink">Inbox</span>
            <span className="block text-[10.5px] text-ink-3">
              {lastSyncAt ? `Refreshed ${relativeTime(lastSyncAt)}` : "Not refreshed yet"}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
