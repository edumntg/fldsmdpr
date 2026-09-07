import { create } from "zustand";
import type { AppNotification } from "../lib/types";
import { launchOrca } from "../lib/ipc";
import { repoLocalPath } from "../lib/pty";
import { useTerminal } from "./terminal";
import { buildAgentPrompt, worktreeName } from "../features/agents/prompt";

export type AgentStatus = "starting" | "working" | "thinking" | "done" | "failed";

export interface AgentRun {
  notificationId: string;
  runner: "orca" | "claude";
  status: AgentStatus;
  label: string; // the action, e.g. "Review with agent"
  detail?: string; // worktree name / last status / error
  startedAt: number;
  endedAt?: number;
}

export const isActive = (s: AgentStatus) => s === "starting" || s === "working" || s === "thinking";

interface AgentsState {
  runs: Record<string, AgentRun>;
  launch: (n: AppNotification, label: string, runner: "orca" | "claude") => Promise<void>;
  setStatus: (notificationId: string, status: AgentStatus, detail?: string) => void;
  clear: (notificationId: string) => void;
}

export const useAgents = create<AgentsState>((set, get) => ({
  runs: {},

  setStatus: (id, status, detail) =>
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      return {
        runs: {
          ...s.runs,
          [id]: {
            ...run,
            status,
            detail: detail ?? run.detail,
            endedAt: status === "done" || status === "failed" ? Date.now() : run.endedAt,
          },
        },
      };
    }),

  clear: (id) =>
    set((s) => {
      const runs = { ...s.runs };
      delete runs[id];
      return { runs };
    }),

  launch: async (n, label, runner) => {
    const repo = n.meta?.repo;
    set((s) => ({
      runs: {
        ...s.runs,
        [n.id]: { notificationId: n.id, runner, status: "starting", label, startedAt: Date.now() },
      },
    }));

    if (runner === "claude") {
      const cwd = repo ? ((await repoLocalPath(repo)) ?? undefined) : undefined;
      useTerminal.getState().openClaude({
        cwd,
        prompt: buildAgentPrompt(n, label),
        title: `claude · ${n.meta?.number ?? n.meta?.key ?? repo ?? "task"}`,
        notificationId: n.id,
      });
      get().setStatus(
        n.id,
        "working",
        cwd ? `Built-in terminal · ${cwd.split("/").pop()}` : "Built-in terminal (repo not found locally)",
      );
      return;
    }

    // Orca
    if (!repo) {
      get().setStatus(n.id, "failed", "No repository to work in");
      return;
    }
    try {
      const res = await launchOrca({
        name: worktreeName(n),
        repo,
        prompt: buildAgentPrompt(n, label),
        comment: n.url,
      });
      get().setStatus(n.id, "working", `Orca worktree · ${res.worktree}`);
    } catch (e) {
      get().setStatus(n.id, "failed", e instanceof Error ? e.message : String(e));
    }
  },
}));
