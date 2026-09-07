import { Loader2, CheckCircle2, XCircle, Bot, X } from "lucide-react";
import { useAgents, isActive, type AgentRun } from "../../stores/agents";
import { cn } from "../../lib/utils";

const statusLabel: Record<AgentRun["status"], string> = {
  starting: "Starting…",
  working: "Working…",
  thinking: "Thinking…",
  done: "Done",
  failed: "Failed",
};

/** Compact progress row shown under a notification card while an agent runs. */
export function AgentStatusRow({ run }: { run: AgentRun }) {
  const active = isActive(run.status);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-src-agent/8 px-2 py-1.5">
      {active ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-src-agent" />
      ) : run.status === "done" ? (
        <CheckCircle2 size={12} className="shrink-0 text-success" />
      ) : (
        <XCircle size={12} className="shrink-0 text-danger" />
      )}
      <Bot size={11} className="shrink-0 text-src-agent" />
      <span
        className={cn(
          "text-[11.5px] font-medium",
          active ? "text-src-agent" : run.status === "failed" ? "text-danger" : "text-ink-2",
        )}
      >
        {statusLabel[run.status]}
      </span>
      <span className="truncate text-[11px] text-ink-3">
        {run.runner === "orca" ? "Orca" : "Claude"}
        {run.detail ? ` · ${run.detail}` : ""}
      </span>
    </div>
  );
}

/** Fuller status panel for the detail pane. */
export function AgentStatusPanel({ run }: { run: AgentRun }) {
  const active = isActive(run.status);
  const clear = useAgents((s) => s.clear);
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-src-agent/20 bg-src-agent/8 p-3">
      {active ? (
        <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-src-agent" />
      ) : run.status === "done" ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
      ) : (
        <XCircle size={16} className="mt-0.5 shrink-0 text-danger" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">
          {run.runner === "orca" ? "Orca agent" : "Claude Code"} — {statusLabel[run.status].replace("…", "")}
        </p>
        <p className="mt-0.5 text-xs text-ink-2">{run.detail ?? run.label}</p>
      </div>
      {!active && (
        <button
          onClick={() => clear(run.notificationId)}
          className="cursor-default rounded p-0.5 text-ink-3 hover:text-ink"
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
