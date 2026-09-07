import { useEffect, useState } from "react";
import { ChevronDown, CheckCircle2, Calendar as CalIcon, RefreshCw, Link2 } from "lucide-react";
import { providerMeta } from "./providerMeta";
import { ConnectionCard } from "./ConnectionCard";
import {
  maccalConfig,
  maccalListCalendars,
  maccalSetConfig,
  type MacCalConfig,
} from "../../lib/ipc";
import { Chip } from "../../components/ui/Chip";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { cn } from "../../lib/utils";

const meta = providerMeta("gcal")!;

/**
 * Calendar connection. Primary path reads the local macOS Calendar (which can
 * include a Google account synced via System Settings → Internet Accounts) —
 * no OAuth, no app, no public iCal URL, so it works even when the org locks
 * those down. The secret-iCal-URL path stays as an advanced fallback.
 */
export function CalendarCard({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [cfg, setCfg] = useState<MacCalConfig | null>(null);
  const [all, setAll] = useState<string[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIcal, setShowIcal] = useState(false);

  useEffect(() => {
    void maccalConfig().then(setCfg);
  }, []);

  const selected = new Set(cfg?.calendars ?? []);
  const connected = (cfg?.enabled && (cfg?.calendars.length ?? 0) > 0) ?? false;

  const persist = async (enabled: boolean, calendars: string[]) => {
    await maccalSetConfig(enabled, calendars);
    setCfg((c) => (c ? { ...c, enabled, calendars } : c));
  };

  const loadCalendars = async () => {
    setLoadingList(true);
    setError(null);
    try {
      setAll(await maccalListCalendars());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  };

  const enable = async () => {
    await persist(true, cfg?.calendars ?? []);
    await loadCalendars();
  };

  const toggleCal = async (name: string) => {
    const next = selected.has(name)
      ? (cfg?.calendars ?? []).filter((c) => c !== name)
      : [...(cfg?.calendars ?? []), name];
    await persist(true, next);
  };

  return (
    <div className="rounded-card border border-line bg-surface-2 shadow-card">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full cursor-default items-center gap-3 p-4 text-left"
      >
        <SourceBadge source="gcal" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold">Calendar</span>
            {connected ? (
              <Chip tone="success">
                <CheckCircle2 size={11} />
                {cfg?.calendars.length} calendar{cfg?.calendars.length === 1 ? "" : "s"}
              </Chip>
            ) : (
              <Chip>Not connected</Chip>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">Local macOS Calendar — no OAuth or app</p>
        </div>
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-ink-3 transition-transform duration-200", expanded && "rotate-180")}
        />
      </button>

      {expanded && (
        <div className="animate-fade-in border-t border-line px-4 pt-3.5 pb-4">
          <div className="rounded-xl bg-accent-soft/50 p-3 text-[13px] text-ink-2">
            <p className="font-medium text-ink">Add your Google calendar to macOS first</p>
            <p className="mt-1">
              System Settings → <span className="font-medium">Internet Accounts</span> → add Google →
              turn on <span className="font-medium">Calendars</span>. It then appears in the list below
              and FLDSMDPR reads it locally — no Google API needed.
            </p>
          </div>

          {!cfg?.enabled ? (
            <button
              onClick={() => void enable()}
              className="mt-3 inline-flex h-8.5 cursor-default items-center gap-2 rounded-pill bg-accent px-3.5 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
            >
              <CalIcon size={14} />
              Use macOS Calendar
            </button>
          ) : (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">
                  Calendars to watch
                </h4>
                <button
                  onClick={() => void loadCalendars()}
                  className="inline-flex cursor-default items-center gap-1 text-[11px] text-ink-3 hover:text-ink"
                >
                  <RefreshCw size={11} className={cn(loadingList && "animate-spin")} />
                  Reload
                </button>
              </div>
              {loadingList && !all && <p className="py-2 text-xs text-ink-3">Reading calendars…</p>}
              {error && <p className="py-2 text-xs text-danger">{error}</p>}
              {all && all.length === 0 && (
                <p className="py-2 text-xs text-ink-3">
                  No calendars found. Add your Google account in Internet Accounts, then Reload.
                </p>
              )}
              {all && all.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
                  {all.map((name) => (
                    <label
                      key={name}
                      className="flex cursor-default items-center gap-2.5 border-b border-line px-3 py-2 last:border-0 hover:bg-surface-3"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(name)}
                        onChange={() => void toggleCal(name)}
                        className="size-3.5 accent-accent"
                      />
                      <CalIcon size={12} className="text-ink-3" />
                      <span className="text-[13px]">{name}</span>
                    </label>
                  ))}
                </div>
              )}
              <button
                onClick={() => void persist(false, cfg.calendars)}
                className="mt-3 cursor-default text-xs text-ink-3 hover:text-danger"
              >
                Turn off macOS Calendar
              </button>
            </div>
          )}

          {/* Advanced fallback: secret iCal URL */}
          <div className="mt-4 border-t border-line pt-3">
            <button
              onClick={() => setShowIcal((s) => !s)}
              className="inline-flex cursor-default items-center gap-1.5 text-xs font-medium text-ink-3 hover:text-ink"
            >
              <Link2 size={12} />
              Advanced: use a secret iCal URL instead
              <ChevronDown size={12} className={cn("transition-transform", showIcal && "rotate-180")} />
            </button>
            {showIcal && (
              <div className="mt-2">
                <ConnectionCard meta={meta} defaultExpanded />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
