import { create } from "zustand";
import type { AppNotification } from "../lib/types";
import { launchOrca, agentSessionUpsert, agentNotify, kvGet } from "../lib/ipc";
import { DEFAULT_AGENT_MODEL } from "../lib/models";
import { useInbox } from "./inbox";
import { repoLocalPath } from "../lib/pty";
import { useTerminal } from "./terminal";
import { buildAgentPrompt, worktreeName } from "../features/agents/prompt";

export type AgentStatus = "starting" | "working" | "thinking" | "waiting" | "done" | "failed";

export interface AgentRun {
  id: string; // session id (persisted)
  notificationId: string;
  runner: "orca" | "claude";
  status: AgentStatus;
  label: string; // the action, e.g. "Review with agent"
  title: string; // what it's working on
  source: string; // where the work came from (github/linear/slack/…)
  detail?: string; // worktree name / last status / error
  startedAt: number;
  endedAt?: number;
}

/** Fire-and-forget write-through so the Agents view survives restarts. */
function persist(run: AgentRun) {
  void agentSessionUpsert({
    id: run.id,
    notification_id: run.notificationId,
    mode: run.runner,
    status: run.status,
    title: run.title,
    source: run.source,
    label: run.label,
    detail: run.detail ?? null,
    started_at: run.startedAt,
    ended_at: run.endedAt ?? null,
  });
}

/** Busy: spinner-worthy. */
export const isActive = (s: AgentStatus) => s === "starting" || s === "working" || s === "thinking";
/** Live: the session still exists (busy or paused waiting on the user). */
export const isLive = (s: AgentStatus) => isActive(s) || s === "waiting";

interface AgentsState {
  runs: Record<string, AgentRun>;
  launch: (
    n: AppNotification,
    label: string,
    runner: "orca" | "claude",
    opts?: { repoId?: string; repoName?: string; cwd?: string; extra?: string; model?: string },
  ) => Promise<void>;
  setStatus: (notificationId: string, status: AgentStatus, detail?: string) => void;
  clear: (notificationId: string) => void;
}

export const useAgents = create<AgentsState>((set, get) => ({
  runs: {},

  setStatus: (id, status, detail) =>
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      const next: AgentRun = {
        ...run,
        status,
        detail: detail ?? run.detail,
        endedAt: status === "done" || status === "failed" ? Date.now() : run.endedAt,
      };
      persist(next);
      // Surface Claude-run milestones: native ping when it pauses for you,
      // inbox notification when it finishes (skip user-closed terminals and
      // Orca dispatches — those aren't real completions).
      if (run.runner === "claude" && run.status !== status) {
        const kind =
          status === "waiting" ? "waiting" : status === "failed" ? "failed" : status === "done" ? "done" : null;
        if (kind && !(kind === "done" && next.detail === "Terminal closed")) {
          void agentNotify({
            runId: run.id,
            origId: run.notificationId,
            title: run.title,
            detail: `${run.label} · ${next.detail ?? ""}`,
            kind,
          }).then(() => {
            if (kind !== "waiting") void useInbox.getState().reload();
          });
        }
      }
      return { runs: { ...s.runs, [id]: next } };
    }),

  clear: (id) =>
    set((s) => {
      const runs = { ...s.runs };
      delete runs[id];
      return { runs };
    }),

  launch: async (n, label, runner, opts) => {
    const repo = opts?.repoName ?? n.meta?.repo;
    const startedAt = Date.now();
    const run: AgentRun = {
      id: `${n.id}:${startedAt}`,
      notificationId: n.id,
      runner,
      status: "starting",
      label,
      title: n.title,
      source: n.source,
      startedAt,
    };
    persist(run);
    set((s) => ({ runs: { ...s.runs, [n.id]: run } }));

    if (runner === "claude") {
      const cwd = opts?.cwd ?? (repo ? ((await repoLocalPath(repo)) ?? undefined) : undefined);
      // Model: explicit pick > last saved choice > Fable 5.
      const model =
        opts?.model ?? (await kvGet("agent_model").catch(() => null)) ?? DEFAULT_AGENT_MODEL;
      useTerminal.getState().openClaude({
        cwd,
        prompt: buildAgentPrompt(n, label, opts?.extra),
        title: `claude · ${n.meta?.number ?? n.meta?.key ?? repo ?? "task"}`,
        notificationId: n.id,
        runId: run.id,
        model,
      });
      get().setStatus(
        n.id,
        "working",
        cwd ? `Built-in terminal · ${cwd.split("/").pop()}` : "Built-in terminal (repo not found locally)",
      );
      return;
    }

    // Orca
    if (!repo && !opts?.repoId) {
      get().setStatus(n.id, "failed", "No repository selected");
      return;
    }
    try {
      const res = await launchOrca({
        name: worktreeName(n),
        repo: repo ?? "",
        prompt: buildAgentPrompt(n, label, opts?.extra),
        comment: n.url,
        repoId: opts?.repoId,
      });
      // From this app's perspective the dispatch is complete — the agent now
      // lives in Orca (we can't track its progress here), so don't leave a
      // forever-spinner blocking relaunch.
      get().setStatus(n.id, "done", `Launched in Orca · ${res.worktree}`);
    } catch (e) {
      get().setStatus(n.id, "failed", e instanceof Error ? e.message : String(e));
    }
  },
}));
