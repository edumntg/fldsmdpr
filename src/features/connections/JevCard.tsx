import { useState } from "react";
import { Sparkles, Loader2, Unplug, CheckCircle2, RefreshCw, ExternalLink, ShieldAlert } from "lucide-react";
import { useJev } from "../../stores/jev";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { cn, relativeTime, openExternal } from "../../lib/utils";

/**
 * AI triage via Jev (TypeSafe's decision model) on OpenRouter. One key, one
 * toggle. Judges urgency + suggested agent action per item, links Sentry
 * errors to PRs/tickets, and reads agent terminals for a done/failed verdict.
 */
export function JevCard() {
  const { connected, enabled, lastRun, judged, running, error, connect, disconnect, setEnabled, run } = useJev();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const onConnect = async () => {
    setBusy(true);
    setConnectError(null);
    try {
      await connect(key);
      setKey("");
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface-2 p-4 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-src-agent/12 p-1.5 text-src-agent">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold">AI triage</h3>
            <span className="rounded-pill bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
              Jev 1.13 via OpenRouter
            </span>
            {connected ? (
              <Chip tone="success">
                <CheckCircle2 size={11} />
                Connected
              </Chip>
            ) : (
              <Chip>Not connected</Chip>
            )}
          </div>
        </div>
        {connected && (
          <label className="flex cursor-default items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => void setEnabled(e.target.checked)}
              className="size-3.5 accent-accent"
            />
            Enabled
          </label>
        )}
      </div>

      <p className="mt-2 text-[13px] leading-5 text-ink-2">
        A fast decision model (not a chatbot) judges every new item: how urgent it is, whether it
        needs you, and what an agent should do about it. It also links Sentry errors to the PRs and
        tickets that likely caused or fix them, and tells whether an agent run finished or got stuck.
        Roughly $0.04 per million input tokens, output free — a full sync costs well under a cent.
      </p>

      <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-warning/10 px-2.5 py-2 text-xs text-ink-2">
        <ShieldAlert size={13} className="mt-0.5 shrink-0 text-warning" />
        <span>
          Titles and snippets of your PRs, tickets and errors are sent to OpenRouter / TypeSafe for
          judging. Nothing else leaves the machine. Turn it off any time.
        </span>
      </div>

      {!connected ? (
        <div className="mt-3">
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && key && !busy && void onConnect()}
              placeholder="sk-or-v1-…"
              className="h-8.5 flex-1 rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            />
            <Button variant="primary" disabled={!key || busy} onClick={() => void onConnect()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Connect
            </Button>
          </div>
          <button
            onClick={() => void openExternal("https://openrouter.ai/settings/keys")}
            className="mt-2 inline-flex cursor-default items-center gap-1.5 text-xs font-medium text-accent hover:underline"
          >
            <ExternalLink size={12} />
            Get an OpenRouter API key
          </button>
          {connectError && <p className="mt-2 text-xs text-danger">{connectError}</p>}
          <p className="mt-2 text-[11px] text-ink-3">
            The key is verified with one tiny decision and stored only in your OS keychain.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-3/60 px-3 py-2">
          {running ? (
            <>
              <Loader2 size={13} className="animate-spin text-src-agent" />
              <span className="text-[13px] font-medium text-src-agent">Judging your inbox…</span>
            </>
          ) : (
            <span className="text-xs text-ink-3">
              {error
                ? `Last run failed: ${error}`
                : lastRun
                  ? `${judged} items judged · last run ${relativeTime(lastRun)}`
                  : "Runs automatically on every sync"}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void run()}
              disabled={running || !enabled}
              className={cn(
                "inline-flex cursor-default items-center gap-1 text-xs font-medium",
                enabled && !running ? "text-accent hover:underline" : "text-ink-3",
              )}
            >
              <RefreshCw size={11} />
              Analyze now
            </button>
            <Button variant="danger" size="sm" onClick={() => void disconnect()}>
              <Unplug size={12} />
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
