import { useEffect, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Loader2,
  Unplug,
  CheckCircle2,
  Hash,
  RefreshCw,
} from "lucide-react";
import { providerMeta } from "./providerMeta";
import { useConnections } from "../../stores/connections";
import {
  slackConnect,
  slackListChannels,
  slackGetChannels,
  slackSetChannels,
  type SlackChannel,
} from "../../lib/ipc";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { cn } from "../../lib/utils";

const meta = providerMeta("slack")!;

async function openExternal(url: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}

/**
 * Slack-specific connection: session-token auth (xoxc + xoxd) since the org
 * blocks creating Slack apps. Adds a channel opt-in picker once connected.
 */
export function SlackConnectionCard({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const { statuses, refresh, disconnect } = useConnections();
  const status = statuses.find((s) => s.id === "slack");
  const connected = status?.connected ?? false;

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [xoxc, setXoxc] = useState("");
  const [xoxd, setXoxd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await slackConnect(xoxc, xoxd);
      setXoxc("");
      setXoxd("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface-2 shadow-card">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full cursor-default items-center gap-3 p-4 text-left"
      >
        <SourceBadge source="slack" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold">Slack</span>
            {connected ? (
              <Chip tone="success">
                <CheckCircle2 size={11} />
                {status?.account ?? "Connected"}
              </Chip>
            ) : (
              <Chip>Not connected</Chip>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">{meta.tokenLabel}</p>
        </div>
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-ink-3 transition-transform duration-200", expanded && "rotate-180")}
        />
      </button>

      {expanded && (
        <div className="animate-fade-in border-t border-line px-4 pt-3.5 pb-4">
          {!connected ? (
            <>
              <h4 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Setup guide</h4>
              <ol className="mt-3 flex flex-col">
                {meta.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10.5px] font-bold text-accent ring-1 ring-accent/20">
                        {i + 1}
                      </span>
                      {i < meta.steps.length - 1 && (
                        <span className="w-px flex-1 bg-gradient-to-b from-accent/25 to-line-strong" />
                      )}
                    </div>
                    <p
                      className={cn(
                        "min-w-0 flex-1 text-[13px] leading-5 text-ink-2",
                        i < meta.steps.length - 1 && "pb-3.5",
                      )}
                    >
                      {s.includes("Object.values(") ? (
                        <>
                          Get your token: open the Console and copy the{" "}
                          <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11px] select-text">
                            xoxc-…
                          </code>{" "}
                          result of:
                          <code className="mt-1 block rounded-lg bg-surface-3 p-2 font-mono text-[11px] break-all select-text">
                            Object.values(JSON.parse(localStorage.localConfig_v2).teams)[0].token
                          </code>
                        </>
                      ) : (
                        s
                      )}
                    </p>
                  </li>
                ))}
              </ol>

              <button
                onClick={() => void openExternal(meta.createUrl)}
                className="mt-3 inline-flex cursor-default items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
              >
                <ExternalLink size={13} />
                {meta.createUrlLabel}
              </button>

              <div className="mt-4 flex flex-col gap-2">
                <input
                  type="password"
                  value={xoxc}
                  onChange={(e) => setXoxc(e.target.value)}
                  placeholder="xoxc-… (token)"
                  className="h-8.5 rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
                />
                <input
                  type="password"
                  value={xoxd}
                  onChange={(e) => setXoxd(e.target.value)}
                  placeholder="xoxd-… (d cookie)"
                  className="h-8.5 rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
                />
                <Button
                  variant="primary"
                  disabled={!xoxc || busy}
                  onClick={() => void onConnect()}
                  className="self-start"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                  Connect
                </Button>
              </div>
            </>
          ) : (
            <ChannelPicker />
          )}

          {error && <p className="mt-2.5 text-xs text-danger">{error}</p>}

          <div className={cn("flex items-center", connected ? "mt-4" : "mt-3")}>
            {connected && (
              <Button variant="danger" size="sm" onClick={() => void disconnect("slack")}>
                <Unplug size={13} />
                Disconnect
              </Button>
            )}
            <p className="ml-auto max-w-80 text-right text-[11px] text-ink-3">
              Session tokens are read-only and stored only in your OS keychain. The xoxc token rotates
              periodically — re-paste it if Slack sync starts failing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelPicker() {
  const [all, setAll] = useState<SlackChannel[] | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [channels, opted] = await Promise.all([slackListChannels(), slackGetChannels()]);
      setAll(channels);
      setSelected(Object.fromEntries(opted.map((c) => [c.id, c.name])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = (c: SlackChannel) => {
    setSaved(false);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[c.id]) delete next[c.id];
      else next[c.id] = c.name;
      return next;
    });
  };

  const save = async () => {
    await slackSetChannels(Object.entries(selected).map(([id, name]) => ({ id, name })));
    setSaved(true);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Channels to watch</h4>
        <button
          onClick={() => void load()}
          className="inline-flex cursor-default items-center gap-1 text-[11px] text-ink-3 hover:text-ink"
        >
          <RefreshCw size={11} className={cn(loading && "animate-spin")} />
          Reload
        </button>
      </div>

      {loading && !all && <p className="py-3 text-xs text-ink-3">Loading channels…</p>}
      {error && <p className="py-2 text-xs text-danger">{error}</p>}

      {all && (
        <>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
            {all.map((c) => (
              <label
                key={c.id}
                className="flex cursor-default items-center gap-2.5 border-b border-line px-3 py-2 last:border-0 hover:bg-surface-3"
              >
                <input
                  type="checkbox"
                  checked={!!selected[c.id]}
                  onChange={() => toggle(c)}
                  className="size-3.5 accent-accent"
                />
                <Hash size={12} className="text-ink-3" />
                <span className="text-[13px]">{c.name.replace(/^#/, "")}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => void save()}>
              Save channels
            </Button>
            <span className="text-xs text-ink-3">
              {Object.keys(selected).length} selected
              {saved && " · saved"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
