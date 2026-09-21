import { useEffect, useState } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { useAiSources, type AiSource } from "../../stores/aiSources";
import { kvGet, kvSet } from "../../lib/ipc";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { relativeTime, cn } from "../../lib/utils";

const COPY: Record<AiSource, { name: string; blurb: string }> = {
  notion: {
    name: "Notion",
    blurb:
      "Uses the claude CLI's Notion connector to find pages and tasks assigned to you, mentions, and docs waiting on your input — no Notion API key needed.",
  },
  granola: {
    name: "Granola (meetings)",
    blurb:
      "Uses the claude CLI's Granola connector to pull action items assigned to you from your recent meeting notes — no extra token needed.",
  },
};

/**
 * Connection card for sources that flow through headless claude + MCP
 * a toggle instead of a token, since claude already holds
 * the connection.
 */
const GRANOLA_WINDOWS = [
  { hours: 24, label: "Last 24 hours" },
  { hours: 48, label: "Last 48 hours" },
  { hours: 72, label: "Last 3 days" },
  { hours: 168, label: "Last 7 days" },
  { hours: 336, label: "Last 14 days" },
];

export function AiSourceCard({ source }: { source: AiSource }) {
  const { sources, loaded, init, sync, setEnabled } = useAiSources();
  const st = sources[source];
  const { name, blurb } = COPY[source];
  const [windowHours, setWindowHours] = useState(48);

  useEffect(() => {
    if (!loaded) void init();
  }, [loaded, init]);
  useEffect(() => {
    if (source === "granola") void kvGet("granola:window_hours").then((v) => v && setWindowHours(Number(v)));
  }, [source]);

  const changeWindow = async (hours: number) => {
    setWindowHours(hours);
    await kvSet("granola:window_hours", String(hours));
    // A wider window has meetings the incremental cursor would skip — start fresh.
    await kvSet("granola:ai_last_sync", "");
    if (st.enabled) void sync(source);
  };

  return (
    <div className="rounded-card border border-line bg-surface-2 p-4 shadow-card">
      <div className="flex items-center gap-2.5">
        <SourceBadge source={source} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold">{name}</h3>
            <span className="inline-flex items-center gap-1 rounded-pill bg-src-agent/12 px-1.5 py-0.5 text-[10px] font-medium text-src-agent">
              <Sparkles size={10} />
              via Claude
            </span>
          </div>
        </div>
        <label className="flex cursor-default items-center gap-2 text-[13px] font-medium">
          <input
            type="checkbox"
            checked={st.enabled}
            disabled={!st.available && !st.enabled}
            onChange={(e) => void setEnabled(source, e.target.checked)}
            className="size-3.5 accent-accent"
          />
          Enabled
        </label>
      </div>

      <p className="mt-2 text-[13px] leading-5 text-ink-2">{blurb}</p>

      {source === "granola" && (
        <label className="mt-2.5 flex items-center justify-between gap-3 text-[13px]">
          <span>
            <span className="font-medium">Meetings to review</span>
            <span className="block text-xs text-ink-3">How far back each full analysis looks.</span>
          </span>
          <select
            value={windowHours}
            onChange={(e) => void changeWindow(Number(e.target.value))}
            className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-xs outline-none focus:border-accent"
          >
            {GRANOLA_WINDOWS.map((w) => (
              <option key={w.hours} value={w.hours}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {!st.available && (
        <p className="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-ink-2">
          The <span className="font-mono">claude</span> CLI wasn't found. Install Claude Code and make
          sure the {COPY[source].name.split(" ")[0]} connector shows “Connected” in{" "}
          <span className="font-mono">claude mcp list</span>.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-3/60 px-3 py-2">
        {st.running ? (
          <>
            <Loader2 size={13} className="animate-spin text-src-agent" />
            <span className="text-[13px] font-medium text-src-agent">Analyzing your {name}…</span>
            <span className="text-[11px] text-ink-3">this takes ~1 min</span>
          </>
        ) : (
          <>
            <span className="text-xs text-ink-3">
              {st.lastError
                ? `Last run failed: ${st.lastError}`
                : st.lastSyncAt
                  ? `Last analyzed ${relativeTime(st.lastSyncAt)}`
                  : st.enabled
                    ? "Not analyzed yet"
                    : "Enable to start analyzing"}
            </span>
            <button
              onClick={() => void sync(source)}
              disabled={!st.enabled}
              className={cn(
                "ml-auto inline-flex cursor-default items-center gap-1 text-xs font-medium",
                st.enabled ? "text-accent hover:underline" : "text-ink-3",
              )}
            >
              <RefreshCw size={11} />
              Analyze now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
