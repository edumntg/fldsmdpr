import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, TerminalSquare, ArrowLeft, Loader2, FolderGit2, Check } from "lucide-react";
import type { AppNotification } from "../../lib/types";
import { orcaStatus, orcaRepos, type OrcaRepo } from "../../lib/ipc";
import { useAgents, isActive } from "../../stores/agents";
import { AgentStatusRow } from "./AgentStatusRow";
import { cn } from "../../lib/utils";

interface Props {
  n: AppNotification;
  label: string;
  icon: typeof Bot;
}

type MenuView = "runners" | "orca-repos";

/**
 * Split button: primary click opens the Orca repo picker; the chevron opens a
 * menu to choose Orca or the built-in Claude Code. Orca launches always let the
 * user pick which registered repo to work in (the notification's repo is
 * matched and shown first). Delegates to the agents store for live status.
 */
export function AgentRunButton({ n, label, icon: Icon }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("runners");
  const [orcaInstalled, setOrcaInstalled] = useState(false);
  const [repos, setRepos] = useState<OrcaRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
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

  const openMenu = (v: MenuView) => {
    setView(v);
    setOpen(true);
    if (v === "orca-repos") void loadRepos();
  };

  const loadRepos = async () => {
    setLoadingRepos(true);
    setRepoError(null);
    try {
      setRepos(await orcaRepos());
    } catch (e) {
      setRepoError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRepos(false);
    }
  };

  const runClaude = () => {
    setOpen(false);
    void launch(n, label, "claude");
  };

  const runOrca = (repo: OrcaRepo) => {
    setOpen(false);
    void launch(n, label, "orca", { repoId: repo.id, repoName: repo.name });
  };

  // While an agent is running (or just finished), show its status instead of the button.
  if (run && isActive(run.status)) {
    return <AgentStatusRow run={run} />;
  }

  // The notification's repo (e.g. "owner/name"): used to highlight a match.
  const notifRepo = n.meta?.repo?.toLowerCase();
  const matches = (r: OrcaRepo) =>
    !!notifRepo &&
    (r.remote?.toLowerCase().endsWith(`/${notifRepo.split("/").pop()}`) ||
      r.name.toLowerCase() === notifRepo.split("/").pop());

  return (
    <div className="relative inline-flex flex-col" ref={menuRef}>
      <div className="inline-flex">
        <button
          onClick={() => openMenu("orca-repos")}
          className={cn(
            "inline-flex h-8.5 cursor-default items-center gap-2 rounded-l-[999px] bg-accent px-3.5 text-[13px] font-medium text-accent-fg shadow-sm",
            "transition-colors hover:bg-accent-hover",
          )}
        >
          <Icon size={14} />
          {label}
        </button>
        <button
          onClick={() => (open ? setOpen(false) : openMenu("runners"))}
          aria-label="Choose agent runner"
          className="inline-flex h-8.5 cursor-default items-center rounded-r-[999px] border-l border-white/25 bg-accent px-2 text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && (
        <div className="animate-pop-in absolute top-10 left-0 z-30 w-72 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1.5 shadow-pop">
          {view === "runners" ? (
            <>
              <RunnerOption
                icon={Bot}
                title="Run in Orca"
                subtitle={
                  orcaInstalled
                    ? "Pick a repo → worktree + Claude agent"
                    : "Orca CLI not detected on this machine"
                }
                disabled={!orcaInstalled}
                onClick={() => openMenu("orca-repos")}
              />
              <RunnerOption
                icon={TerminalSquare}
                title="Built-in Claude Code"
                subtitle="Runs claude in the FLDSMDPR terminal"
                onClick={runClaude}
              />
            </>
          ) : (
            <div>
              <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
                <button
                  onClick={() => setView("runners")}
                  className="cursor-default rounded p-0.5 text-ink-3 hover:text-ink"
                  aria-label="Back"
                >
                  <ArrowLeft size={14} />
                </button>
                <span className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Select a repo
                </span>
              </div>

              {loadingRepos && (
                <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-ink-3">
                  <Loader2 size={13} className="animate-spin" />
                  Loading Orca repos…
                </div>
              )}
              {repoError && <p className="px-2.5 py-2 text-xs text-danger">{repoError}</p>}
              {repos && repos.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-ink-3">
                  No repos in Orca. Add one there first (orca repo add).
                </p>
              )}

              <div className="max-h-64 overflow-y-auto">
                {repos
                  ?.slice()
                  .sort((a, b) => Number(matches(b)) - Number(matches(a)))
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => runOrca(r)}
                      className="flex w-full cursor-default items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-surface-3"
                    >
                      <FolderGit2 size={14} className="shrink-0 text-ink-2" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{r.name}</span>
                        <span className="block truncate text-[11px] text-ink-3">
                          {r.remote ?? r.path}
                        </span>
                      </span>
                      {matches(r) && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-pill bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          <Check size={9} />
                          match
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {run?.status === "failed" && <p className="mt-2 max-w-72 text-xs text-danger">{run.detail}</p>}
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
