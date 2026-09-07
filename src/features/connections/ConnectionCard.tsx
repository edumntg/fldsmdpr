import { useState } from "react";
import { ChevronDown, ExternalLink, Loader2, Unplug, CheckCircle2 } from "lucide-react";
import type { ProviderMeta } from "./providerMeta";
import { useConnections } from "../../stores/connections";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { cn } from "../../lib/utils";

async function openExternal(url: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}

export function ConnectionCard({
  meta,
  defaultExpanded = false,
}: {
  meta: ProviderMeta;
  defaultExpanded?: boolean;
}) {
  const { statuses, connect, disconnect } = useConnections();
  const status = statuses.find((s) => s.id === meta.id);
  const connected = status?.connected ?? false;

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect(meta.id, token);
      setToken("");
      setExpanded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface-2 shadow-card">
      {/* header row */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full cursor-default items-center gap-3 p-4 text-left"
      >
        <SourceBadge source={meta.id} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold">{meta.name}</span>
            {connected ? (
              <Chip tone="success">
                <CheckCircle2 size={11} />
                {status?.account ?? "Connected"}
              </Chip>
            ) : meta.available ? (
              <Chip>Not connected</Chip>
            ) : (
              <Chip tone="warning">{meta.unavailableNote}</Chip>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">{meta.tokenLabel}</p>
        </div>
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-ink-3 transition-transform duration-200", expanded && "rotate-180")}
        />
      </button>

      {/* setup guide + token form */}
      {expanded && (
        <div className="animate-fade-in border-t border-line px-4 pt-3.5 pb-4">
          <h4 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Setup guide</h4>
          <ol className="mt-3 flex flex-col">
            {meta.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                {/* number bubble + connector line */}
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
                  {s}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-ink-3">Scopes:</span>
            {meta.scopes.map((s) => (
              <Chip key={s} className="font-mono">
                {s}
              </Chip>
            ))}
          </div>

          <button
            onClick={() => void openExternal(meta.createUrl)}
            className="mt-3 inline-flex cursor-default items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
          >
            <ExternalLink size={13} />
            {meta.createUrlLabel}
          </button>

          {meta.available && !connected && (
            <div className="mt-4 flex gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && token && !busy && void onConnect()}
                placeholder={meta.placeholder}
                className="h-8.5 flex-1 rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
              />
              <Button variant="primary" disabled={!token || busy} onClick={() => void onConnect()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Connect
              </Button>
            </div>
          )}

          {connected && (
            <div className="mt-4">
              <Button variant="danger" size="sm" onClick={() => void disconnect(meta.id)}>
                <Unplug size={13} />
                Disconnect
              </Button>
            </div>
          )}

          {error && <p className="mt-2.5 text-xs text-danger">{error}</p>}

          <p className="mt-3 text-[11px] text-ink-3">
            Tokens are validated against the provider's API and stored only in your OS keychain — never on
            disk or any server.
          </p>
        </div>
      )}
    </div>
  );
}
