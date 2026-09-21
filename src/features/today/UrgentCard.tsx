import { useEffect, useState } from "react";
import { Siren, RefreshCw, ArrowRight, Loader2 } from "lucide-react";
import type { AppNotification } from "../../lib/types";
import { urgentPick, kvGet, kvSet, type UrgentResult, type UrgentWindow } from "../../lib/ipc";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { relativeTime, cn } from "../../lib/utils";

/** Top-3 "attack first" picks chosen by Jev (OpenRouter) from the newest inbox items. */
export function UrgentCard({ items, goTo }: { items: AppNotification[]; goTo: (n: AppNotification) => void }) {
  const [window, setWindow] = useState<UrgentWindow>("day");
  const [result, setResult] = useState<UrgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void kvGet("urgent_window").then((w) => w === "week" && setWindow("week"));
  }, []);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await urgentPick(window, force));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  const pickWindow = (w: UrgentWindow) => {
    setWindow(w);
    void kvSet("urgent_window", w);
  };

  // Resolve picks against the live inbox; items already done drop out.
  const picks = (result?.picks ?? [])
    .map((p) => ({ n: items.find((n) => n.id === p.id), reason: p.reason }))
    .filter((p): p is { n: AppNotification; reason: string } => !!p.n && p.n.state !== "done");

  return (
    <div className="rounded-card border border-danger/30 bg-surface-2 p-5 shadow-card">
      <div className="mb-2.5 flex items-center gap-2">
        <Siren size={14} className="text-danger" />
        <h3 className="text-[13px] font-semibold">Urgent · P0</h3>
        <span className="text-[11px] text-ink-3">
          {result ? `Jev · ${result.considered} considered · ${relativeTime(result.at)}` : "Jev picks your top 3"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(["day", "week"] as UrgentWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => pickWindow(w)}
              className={cn(
                "cursor-default rounded-pill px-2 py-0.5 text-[11px] font-medium transition-colors",
                window === w ? "bg-accent-soft text-accent" : "text-ink-3 hover:text-ink",
              )}
            >
              {w === "day" ? "Today" : "This week"}
            </button>
          ))}
          <button
            onClick={() => void load(true)}
            disabled={loading}
            title="Ask Jev again"
            className="ml-1 cursor-default rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <RefreshCw size={12} className={cn(loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-[12.5px] text-danger">{error}</p>
      ) : loading && !result ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-3">
          <Loader2 size={13} className="animate-spin" />
          Asking Jev…
        </p>
      ) : picks.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing urgent in this window.</p>
      ) : (
        <div className="flex flex-col">
          {picks.map(({ n, reason }, i) => (
            <button
              key={n.id}
              onClick={() => goTo(n)}
              className={cn("group flex cursor-default items-center gap-3 py-2 text-left", i > 0 && "border-t border-line")}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-danger/10 text-[11px] font-bold text-danger">
                {i + 1}
              </span>
              <SourceBadge source={n.source} size={13} n={n} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{n.title}</span>
                <span className="block truncate text-xs text-ink-3">{reason || n.snippet}</span>
              </span>
              <span className="shrink-0 text-xs text-ink-3">{relativeTime(n.createdAt)}</span>
              <ArrowRight size={13} className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
