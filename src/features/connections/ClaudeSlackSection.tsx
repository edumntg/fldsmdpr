import { useEffect, useState } from "react";
import { Sparkles, Loader2, Check, X, RefreshCw, PlugZap } from "lucide-react";
import { useSlackAi } from "../../stores/slackAi";
import { slackAiCheck } from "../../lib/ipc";
import { Button } from "../../components/ui/Button";
import { relativeTime, cn } from "../../lib/utils";

/**
 * Primary Slack path: the headless `claude` CLI + official Slack MCP fetches
 * mentions AND judges relevance. No Slack app or token — works with org locks.
 */
export function ClaudeSlackSection() {
  const { available, enabled, aboutMe, running, lastSyncAt, lastError, loaded, init, sync, setConfig } =
    useSlackAi();
  const [draft, setDraft] = useState(aboutMe);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loaded) void init();
  }, [loaded, init]);
  useEffect(() => setDraft(aboutMe), [aboutMe]);

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
        <h4 className="text-[13px] font-semibold">Slack via Claude</h4>
        <span className="rounded-pill bg-src-agent/12 px-1.5 py-0.5 text-[10px] font-medium text-src-agent">
          Recommended
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-ink-2">
        Uses the <span className="font-medium">claude</span> CLI's Slack connector to pull your mentions
        and DMs — and to flag messages that are relevant to you even without an @-mention. No Slack app
        or token needed.
      </p>

      {!available && (
        <p className="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-ink-2">
          The <span className="font-mono">claude</span> CLI wasn't found. Install Claude Code and make
          sure the Slack connector shows “Connected” in <span className="font-mono">claude mcp list</span>.
        </p>
      )}

      {/* About-me profile improves implicit-relevance detection */}
      <label className="mt-3 block text-xs font-medium text-ink-2">
        About you <span className="font-normal text-ink-3">— helps detect relevant messages</span>
      </label>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== aboutMe && void setConfig(enabled, draft)}
        placeholder="e.g. I own the payments webhook and the internal API. Team: Platform. Aliases: Edu, Eduardo. Current projects: notifications migration."
        rows={3}
        className="mt-1 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex cursor-default items-center gap-2 text-[13px] font-medium">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!available}
            onChange={(e) => void setConfig(e.target.checked, draft)}
            className="size-3.5 accent-accent"
          />
          Enable Slack analysis
        </label>

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
            <span className="text-[11px] text-ink-3">this takes ~1 min</span>
          </>
        ) : (
          <>
            <span className="text-xs text-ink-3">
              {lastError
                ? `Last run failed: ${lastError}`
                : lastSyncAt
                  ? `Last analyzed ${relativeTime(lastSyncAt)}`
                  : enabled
                    ? "Not analyzed yet"
                    : "Enable to start analyzing"}
            </span>
            <button
              onClick={() => void sync()}
              disabled={!enabled}
              className={cn(
                "ml-auto inline-flex cursor-default items-center gap-1 text-xs font-medium",
                enabled ? "text-accent hover:underline" : "text-ink-3",
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
