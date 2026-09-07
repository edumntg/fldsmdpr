import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, CirclePause, Bot, TerminalSquare, RefreshCw } from "lucide-react";
import { useAgents, type AgentRun } from "../../stores/agents";
import { agentSessionsList, agentSessionUpsert, type AgentSession } from "../../lib/ipc";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { Chip } from "../../components/ui/Chip";
import { cn, relativeTime } from "../../lib/utils";
import type { Source } from "../../lib/types";

interface WorkRow {
  id: string;
  title: string;
  source: string;
  label: string;
  runner: string;
  status: string;
  detail?: string | null;
  startedAt: number;
  endedAt?: number | null;
  live: boolean;
}

function fromRun(r: AgentRun): WorkRow {
  return { ...r, runner: r.runner, live: true, detail: r.detail, endedAt: r.endedAt ?? null };
}

function fromSession(s: AgentSession): WorkRow {
  return {
    id: s.id,
    title: s.title,
    source: s.source,
    label: s.label,
    runner: s.mode,
    status: s.status,
    detail: s.detail,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    live: false,
  };
}

/** Orca-style work view: every agent run (live and past) with the source icon,
 * a live spinner while working, and outcome details. */
export function AgentsView() {
  const runs = useAgents((s) => s.runs);
  const [history, setHistory] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const sessions = await agentSessionsList();
      // Sessions persisted as active but with no live run were orphaned by an
      // app quit (their PTY died with it) — settle them so they don't spin forever.
      const liveIds = new Set(Object.values(useAgents.getState().runs).map((r) => r.id));
      const ACTIVE = new Set(["starting", "working", "thinking", "waiting"]);
      setHistory(
        sessions.map((s) => {
          if (!ACTIVE.has(s.status) || liveIds.has(s.id)) return s;
          const settled: AgentSession = {
            ...s,
            status: "done",
            detail: "Interrupted — app was closed",
            ended_at: s.ended_at ?? Date.now(),
          };
          void agentSessionUpsert(settled);
          return settled;
        }),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  // Live runs win over their persisted rows (same id).
  const liveRows = Object.values(runs).map(fromRun);
  const liveIds = new Set(liveRows.map((r) => r.id));
  const rows: WorkRow[] = [
    ...liveRows,
    ...history.filter((s) => !liveIds.has(s.id)).map(fromSession),
  ].sort((a, b) => b.startedAt - a.startedAt);

  const active = rows.filter(
    (r) =>
      r.status === "starting" || r.status === "working" || r.status === "thinking" || r.status === "waiting",
  );
  const past = rows.filter((r) => !active.includes(r));

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center px-5">
        <h1 className="text-[15px] font-semibold tracking-tight">Agents</h1>
        {active.length > 0 && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-src-agent">
            <Loader2 size={11} className="animate-spin" />
            {active.length} working
          </span>
        )}
        <button
          onClick={() => void load()}
          className="ml-auto inline-flex cursor-default items-center gap-1 text-[11px] text-ink-3 hover:text-ink"
        >
          <RefreshCw size={11} className={cn(loading && "animate-spin")} />
          Reload
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5 pt-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-6">
          {rows.length === 0 && !loading && (
            <div className="flex flex-col items-center gap-2 py-16 text-ink-3">
              <Bot size={26} strokeWidth={1.5} />
              <p className="text-[13px] font-medium">No agent work yet</p>
              <p className="text-xs">Launch one from any PR, ticket, or Slack item.</p>
            </div>
          )}

          {active.length > 0 && (
            <WorkSection title="In progress" rows={active} />
          )}
          {past.length > 0 && <WorkSection title="History" rows={past} />}
        </div>
      </div>
    </section>
  );
}

function WorkSection({ title, rows }: { title: string; rows: WorkRow[] }) {
  return (
    <div>
      <h2 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <WorkCard key={r.id} r={r} />
        ))}
      </div>
    </div>
  );
}

function WorkCard({ r }: { r: WorkRow }) {
  const running = r.status === "starting" || r.status === "working" || r.status === "thinking";
  const elapsed = r.endedAt
    ? `${Math.max(1, Math.round((r.endedAt - r.startedAt) / 1000))}s`
    : running
      ? relativeTime(r.startedAt).replace(" ago", "")
      : "";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-card border bg-surface-2 p-3.5 shadow-card",
        running ? "border-src-agent/30" : "border-line",
      )}
    >
      <SourceBadge source={(r.source || "agent") as Source} size={14} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.title || r.label}</h3>
          <span className="shrink-0 text-[11px] text-ink-3">{relativeTime(r.startedAt)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip>
            {r.runner === "orca" ? <Bot size={10} /> : <TerminalSquare size={10} />}
            {r.runner === "orca" ? "Orca" : "Claude"}
          </Chip>
          <span className="text-[11px] text-ink-3">{r.label}</span>
          {r.detail && <span className="truncate text-[11px] text-ink-3">· {r.detail}</span>}
          {elapsed && !running && <span className="ml-auto text-[11px] text-ink-3">{elapsed}</span>}
        </div>
      </div>
      <span className="mt-0.5 shrink-0">
        {running ? (
          <Loader2 size={15} className="animate-spin text-src-agent" />
        ) : r.status === "waiting" ? (
          <CirclePause size={15} className="text-warning" />
        ) : r.status === "done" ? (
          <CheckCircle2 size={15} className="text-success" />
        ) : (
          <XCircle size={15} className="text-danger" />
        )}
      </span>
    </div>
  );
}
