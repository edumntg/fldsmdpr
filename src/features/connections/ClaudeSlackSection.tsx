import { useState } from "react";
import { Sparkles, Loader2, Check, X, RefreshCw, PlugZap } from "lucide-react";
import { useSlackAi } from "../../stores/slackAi";
import { slackAiCheck } from "../../lib/ipc";
import { Button } from "../../components/ui/Button";
import { relativeTime, cn } from "../../lib/utils";

/**
 * Primary Slack path: the headless `claude` CLI + official Slack MCP fetches
 * mentions AND judges relevance. No Slack app or token — works with org locks.
 * The "about you" profile it uses lives in Settings → About you.
 */
export function ClaudeSlackSection() {
  const { available, enabled, summaries, running, lastSyncAt, lastError, sync, setSummaries } = useSlackAi();
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<boolean | null>(null);

  const check = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      setCheckResult(await slackAiCheck());
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-src-agent" />
        <h4 className="text-[13px] font-semibold">Day &amp; week summaries via Claude</h4>
        <span className="rounded-pill bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
          Optional · slow
        </span>
        <label className="ml-auto flex cursor-default items-center gap-2 text-[13px] font-medium">
          <input
            type="checkbox"
            checked={summaries}
            disabled={!available}
            onChange={(e) => void setSummaries(e.target.checked)}
            className="size-3.5 accent-accent"
          />
          Enabled
        </label>
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-ink-2">
        The <span className="font-medium">claude</span> CLI reads Slack through its official connector
        and writes the "Slack summary" card (today / this week) plus extracted tasks. Each round is an
        agentic read that takes a few minutes, so it runs at most hourly. Mentions, DMs and relevance
        already come from the fast path above — leave this off if you only want the inbox items.
      </p>

      {!available && (
        <p className="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-ink-2">
          The <span className="font-mono">claude</span> CLI wasn't found. Install Claude Code and make
          sure the Slack connector shows “Connected” in <span className="font-mono">claude mcp list</span>.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void check()} disabled={checking || !available}>
          {checking ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
          Check connection
        </Button>
        {checkResult === true && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check size={12} /> Slack connected
          </span>
        )}
        {checkResult === false && (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <X size={12} /> Slack not connected in claude
          </span>
        )}
      </div>

      {/* Live status while a (slow) analysis round runs */}
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-3/60 px-3 py-2">
        {running ? (
          <>
            <Loader2 size={13} className="animate-spin text-src-agent" />
            <span className="text-[13px] font-medium text-src-agent">Analyzing your Slack…</span>
            <span className="text-[11px] text-ink-3">this takes a few minutes</span>
          </>
        ) : (
          <>
            <span className="text-xs text-ink-3">
              {lastError
                ? `Last run failed: ${lastError}`
                : lastSyncAt
                  ? `Last analyzed ${relativeTime(lastSyncAt)}`
                  : "Not analyzed yet"}
            </span>
            <button
              onClick={() => void sync()}
              disabled={!enabled || !available}
              className={cn(
                "ml-auto inline-flex cursor-default items-center gap-1 text-xs font-medium",
                enabled && available ? "text-accent hover:underline" : "text-ink-3",
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
