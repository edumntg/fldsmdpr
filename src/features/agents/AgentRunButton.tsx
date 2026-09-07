import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Loader2, TerminalSquare } from "lucide-react";
import type { AppNotification } from "../../lib/types";
import { launchOrca, orcaStatus } from "../../lib/ipc";
import { buildAgentPrompt, worktreeName } from "./prompt";
import { cn } from "../../lib/utils";

type Runner = "orca" | "claude-code";

interface Props {
  n: AppNotification;
  label: string;
  icon: typeof Bot;
}

/**
 * Split button: primary click runs the preferred runner, the chevron opens a
 * menu to pick Orca (worktree + agent) or the built-in Claude Code (Phase 4).
 */
export function AgentRunButton({ n, label, icon: Icon }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orcaInstalled, setOrcaInstalled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const run = async (runner: Runner) => {
    setOpen(false);
    setError(null);
    if (runner === "claude-code") {
      setError("Built-in Claude Code sessions land in Phase 4 — use Orca meanwhile.");
      return;
    }
    if (!n.meta?.repo) {
      setError("This item has no repository to work in.");
      return;
    }
    setBusy(true);
    try {
      const res = await launchOrca({
        name: worktreeName(n),
        repo: n.meta.repo,
        prompt: buildAgentPrompt(n, label),
        comment: n.url,
      });
      setResult(`Launched in Orca: ${res.worktree}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <span className="inline-flex h-8.5 items-center gap-2 rounded-pill bg-success/12 px-3.5 text-[13px] font-medium text-success">
        <Check size={14} />
        {result}
      </span>
    );
  }

  return (
    <div className="relative inline-flex flex-col" ref={menuRef}>
      <div className="inline-flex">
        <button
          disabled={busy}
          onClick={() => void run("orca")}
          className={cn(
            "inline-flex h-8.5 cursor-default items-center gap-2 rounded-l-[999px] bg-accent px-3.5 text-[13px] font-medium text-accent-fg shadow-sm",
            "transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-60",
          )}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
          {busy ? "Launching…" : label}
        </button>
        <button
          disabled={busy}
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
            onClick={() => void run("orca")}
          />
          <RunnerOption
            icon={TerminalSquare}
            title="Built-in Claude Code"
            subtitle="Runs in the FLDSMDPR terminal — Phase 4"
            disabled
            onClick={() => void run("claude-code")}
          />
        </div>
      )}

      {error && <p className="mt-2 max-w-72 text-xs text-danger">{error}</p>}
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
