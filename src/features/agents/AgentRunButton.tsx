import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, TerminalSquare } from "lucide-react";
import type { AppNotification } from "../../lib/types";
import { orcaStatus } from "../../lib/ipc";
import { useAgents, isActive } from "../../stores/agents";
import { AgentStatusRow } from "./AgentStatusRow";
import { cn } from "../../lib/utils";

interface Props {
  n: AppNotification;
  label: string;
  icon: typeof Bot;
}

/**
 * Split button: primary click runs the preferred runner (Orca), the chevron
 * opens a menu to pick Orca (worktree + agent) or the built-in Claude Code.
 * Delegates to the agents store so the run is tracked with live status.
 */
export function AgentRunButton({ n, label, icon: Icon }: Props) {
  const [open, setOpen] = useState(false);
  const [orcaInstalled, setOrcaInstalled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const launch = useAgents((s) => s.launch);
  const run = useAgents((s) => s.runs[n.id]);

  useEffect(() => {
    void orcaStatus().then((s) => setOrcaInstalled(s.installed));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const doRun = (runner: "orca" | "claude") => {
    setOpen(false);
    void launch(n, label, runner);
  };

  // While an agent is running (or just finished), show its status instead of the button.
  if (run && isActive(run.status)) {
    return <AgentStatusRow run={run} />;
  }

  return (
    <div className="relative inline-flex flex-col" ref={menuRef}>
      <div className="inline-flex">
        <button
          onClick={() => doRun("orca")}
          className={cn(
            "inline-flex h-8.5 cursor-default items-center gap-2 rounded-l-[999px] bg-accent px-3.5 text-[13px] font-medium text-accent-fg shadow-sm",
            "transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-60",
          )}
        >
          <Icon size={14} />
          {label}
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Choose agent runner"
          className="inline-flex h-8.5 cursor-default items-center rounded-r-[999px] border-l border-white/25 bg-accent px-2 text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && (
        <div className="animate-pop-in absolute top-10 left-0 z-30 w-72 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1.5 shadow-pop">
          <RunnerOption
            icon={Bot}
            title="Run in Orca"
            subtitle={
              orcaInstalled
                ? "New worktree + Claude agent, opens in Orca"
                : "Orca CLI not detected on this machine"
            }
            disabled={!orcaInstalled}
            onClick={() => doRun("orca")}
          />
          <RunnerOption
            icon={TerminalSquare}
            title="Built-in Claude Code"
            subtitle="Runs claude in the FLDSMDPR terminal"
            onClick={() => doRun("claude")}
          />
        </div>
      )}

      {run?.status === "failed" && (
        <p className="mt-2 max-w-72 text-xs text-danger">{run.detail}</p>
      )}
    </div>
  );
}

function RunnerOption({
  icon: Icon,
  title,
  subtitle,
  disabled,
  onClick,
}: {
  icon: typeof Bot;
  title: string;
  subtitle: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-default items-start gap-2.5 rounded-lg p-2.5 text-left transition-colors",
        disabled ? "opacity-50" : "hover:bg-surface-3",
      )}
    >
      <Icon size={15} className="mt-0.5 shrink-0 text-ink-2" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="block text-[11.5px] text-ink-3">{subtitle}</span>
      </span>
    </button>
  );
}
