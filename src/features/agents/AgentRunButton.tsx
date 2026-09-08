import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  ChevronDown,
  TerminalSquare,
  ArrowLeft,
  Loader2,
  FolderGit2,
  FolderOpen,
  Check,
} from "lucide-react";
import type { AppNotification } from "../../lib/types";
import { orcaStatus, orcaRepos, kvGet, kvSet, type OrcaRepo } from "../../lib/ipc";
import { AGENT_MODELS, DEFAULT_AGENT_MODEL } from "../../lib/models";
import { pickFolder } from "../../lib/pty";
import { useAgents, isActive } from "../../stores/agents";
import { AgentStatusRow } from "./AgentStatusRow";
import { cn } from "../../lib/utils";

type MenuView = "runners" | "orca-repos" | "claude-folder";

/**
 * Shared runner picker: Orca → choose one of Orca's registered repos;
 * Built-in Claude Code → choose the repo folder (Orca paths as quick picks, or
 * a native folder browser). Used by the big split button and the compact
 * quick-launch icon.
 */
function AgentRunnerMenu({
  n,
  label,
  initialView,
  anchorEl,
  onClose,
}: {
  n: AppNotification;
  label: string;
  initialView: MenuView;
  anchorEl: HTMLElement;
  onClose: () => void;
}) {
  const [view, setView] = useState<MenuView>(initialView);
  const [model, setModel] = useState(DEFAULT_AGENT_MODEL);
  const [skipPerms, setSkipPerms] = useState(true);
  const [orcaInstalled, setOrcaInstalled] = useState(false);
  const [repos, setRepos] = useState<OrcaRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const launch = useAgents((s) => s.launch);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void orcaStatus().then((s) => setOrcaInstalled(s.installed));
    void kvGet("agent_model").then((m) => m && setModel(m));
    void kvGet("agent_skip_permissions").then((v) => setSkipPerms(v !== "0"));
  }, []);

  const pickModel = (m: string) => {
    setModel(m);
    void kvSet("agent_model", m); // remembered as the default for next runs
  };
  const toggleSkipPerms = (v: boolean) => {
    setSkipPerms(v);
    void kvSet("agent_skip_permissions", v ? "1" : "0");
  };

  // The menu is portaled to <body>, so close-on-outside-click lives here
  // (clicks on the anchor toggle it from the trigger instead).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !anchorEl.contains(t)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [anchorEl, onClose]);

  // Fixed position clamped to the viewport (flips upward near the bottom) —
  // portaling avoids being clipped by scroll containers or painted behind
  // sibling panes.
  const rect = anchorEl.getBoundingClientRect();
  const MENU_W = 304;
  const MENU_H = 340;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_W - 8));
  const top =
    rect.bottom + 6 + MENU_H > window.innerHeight
      ? Math.max(8, rect.top - MENU_H - 6)
      : rect.bottom + 6;

  useEffect(() => {
    if ((view === "orca-repos" || view === "claude-folder") && repos === null && !loadingRepos) {
      setLoadingRepos(true);
      setRepoError(null);
      orcaRepos()
        .then(setRepos)
        .catch((e) => setRepoError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoadingRepos(false));
    }
  }, [view, repos, loadingRepos]);

  const notifRepo = n.meta?.repo?.toLowerCase();
  const matches = (r: OrcaRepo) =>
    !!notifRepo &&
    (r.remote?.toLowerCase().endsWith(`/${notifRepo.split("/").pop()}`) ||
      r.name.toLowerCase() === notifRepo.split("/").pop());

  const sortedRepos = repos
    ?.slice()
    .sort((a, b) => Number(matches(b)) - Number(matches(a)));

  const runOrca = (repo: OrcaRepo) => {
    onClose();
    void launch(n, label, "orca", { repoId: repo.id, repoName: repo.name });
  };
  const runClaude = (cwd: string) => {
    onClose();
    void launch(n, label, "claude", { cwd, model, skipPermissions: skipPerms });
  };
  const browseAndRun = async () => {
    const folder = await pickFolder();
    if (folder) runClaude(folder);
  };

  const repoList = (onPick: (r: OrcaRepo) => void, subtitleOf: (r: OrcaRepo) => string) => (
    <div className="max-h-64 overflow-y-auto">
      {loadingRepos && (
        <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-ink-3">
          <Loader2 size={13} className="animate-spin" />
          Loading Orca repos…
        </div>
      )}
      {repoError && <p className="px-2.5 py-2 text-xs text-danger">{repoError}</p>}
      {sortedRepos?.map((r) => (
        <button
          key={r.id}
          onClick={() => onPick(r)}
          className="flex w-full cursor-default items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-surface-3"
        >
          <FolderGit2 size={14} className="shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{r.name}</span>
            <span className="block truncate text-[11px] text-ink-3">{subtitleOf(r)}</span>
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
  );

  return createPortal(
    <div
      ref={menuRef}
      style={{ top, left }}
      className="animate-pop-in fixed z-50 w-76 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1.5 shadow-pop"
    >
      {view === "runners" && (
        <>
          <RunnerOption
            icon={Bot}
            title="Run in Orca"
            subtitle={
              orcaInstalled ? "Pick a repo → worktree + Claude agent" : "Orca CLI not detected"
            }
            disabled={!orcaInstalled}
            onClick={() => setView("orca-repos")}
          />
          <RunnerOption
            icon={TerminalSquare}
            title="Built-in Claude Code"
            subtitle="Pick the repo folder → runs in the terminal"
            onClick={() => setView("claude-folder")}
          />
        </>
      )}

      {view !== "runners" && (
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
              {view === "orca-repos" ? "Select a repo (Orca)" : "Select the repo folder (Claude)"}
            </span>
          </div>

          {view === "orca-repos" && repoList(runOrca, (r) => r.remote ?? r.path)}

          {view === "claude-folder" && (
            <>
              <label className="mb-1.5 flex items-center gap-2 px-1.5">
                <span className="text-[11px] font-medium text-ink-3">Model</span>
                <select
                  value={model}
                  onChange={(e) => pickModel(e.target.value)}
                  className="h-7 flex-1 rounded-lg border border-line bg-surface px-2 text-xs outline-none focus:border-accent"
                >
                  {AGENT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mb-1.5 flex cursor-default items-center gap-2 px-1.5 text-[11.5px] text-ink-2">
                <input
                  type="checkbox"
                  checked={skipPerms}
                  onChange={(e) => toggleSkipPerms(e.target.checked)}
                  className="size-3 accent-accent"
                />
                Skip permission prompts
                <span className="font-mono text-[10px] text-ink-3">--dangerously-skip-permissions</span>
              </label>
              {repoList((r) => runClaude(r.path), (r) => r.path)}
              <button
                onClick={() => void browseAndRun()}
                className="mt-1 flex w-full cursor-default items-center gap-2.5 rounded-lg border-t border-line p-2 pt-2.5 text-left transition-colors hover:bg-surface-3"
              >
                <FolderOpen size={14} className="shrink-0 text-accent" />
                <span className="text-[13px] font-medium text-accent">Browse for a folder…</span>
              </button>
            </>
          )}

          {sortedRepos?.length === 0 && view === "orca-repos" && (
            <p className="px-2.5 py-2 text-xs text-ink-3">No repos registered in Orca.</p>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

interface ButtonProps {
  n: AppNotification;
  label: string;
  icon: typeof Bot;
}

/** Split button used in the detail pane. */
export function AgentRunButton({ n, label, icon: Icon }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const run = useAgents((s) => s.runs[n.id]);

  if (run && isActive(run.status)) {
    return <AgentStatusRow run={run} />;
  }

  return (
    <div className="inline-flex flex-col">
      <div className="inline-flex" ref={anchorRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-8.5 cursor-default items-center gap-2 rounded-l-[999px] bg-accent px-3.5 text-[13px] font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover"
        >
          <Icon size={14} />
          {label}
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Choose agent runner"
          className="inline-flex h-8.5 cursor-default items-center rounded-r-[999px] border-l border-white/25 bg-accent px-2 text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && anchorRef.current && (
        <AgentRunnerMenu
          n={n}
          label={label}
          initialView="runners"
          anchorEl={anchorRef.current}
          onClose={() => setOpen(false)}
        />
      )}

      {run?.status === "failed" && <p className="mt-2 max-w-72 text-xs text-danger">{run.detail}</p>}
    </div>
  );
}

/** Compact icon trigger (used on Slack summary items). */
export function AgentQuickLaunch({ n, label }: { n: AppNotification; label: string }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const run = useAgents((s) => s.runs[n.id]);

  if (run && isActive(run.status)) {
    return <Loader2 size={13} className="shrink-0 animate-spin text-src-agent" />;
  }
  if (run?.status === "done") {
    return <Check size={13} className="shrink-0 text-success" />;
  }

  return (
    <div ref={anchorRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Run agent on this"
        className="inline-flex size-6 cursor-default items-center justify-center rounded-md text-src-agent transition-colors hover:bg-src-agent/12"
      >
        <Bot size={13} />
      </button>
      {open && anchorRef.current && (
        <AgentRunnerMenu
          n={n}
          label={label}
          initialView="runners"
          anchorEl={anchorRef.current}
          onClose={() => setOpen(false)}
        />
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
