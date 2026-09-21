import { useEffect, useMemo, useRef } from "react";
import { Bot, TerminalSquare, CheckCircle2, XCircle, CirclePause, Loader2, GitPullRequest, Sparkles } from "lucide-react";
import { FlowStage, FlowBox, FlowChip, useFlowTokens, type FlowNode, type FlowEdge } from "../../components/flow/FlowStage";
import { useAgents, isActive, runnerLabel, type AgentRun } from "../../stores/agents";
import { useTerminal } from "../../stores/terminal";
import { SourceBadge } from "../../components/ui/SourceBadge";
import type { AppNotification } from "../../lib/types";

const W = 560;
const H = 104;
const NODE = { y: 24, w: 116, h: 56 };
const X = [0, 148, 296, 444];

/**
 * Where the agent is right now, as a flow: the item hands off to the agent,
 * the agent works in its workspace (terminal / worktree), the result lands.
 * Hook events (working / waiting / done / failed) drive the animation.
 */
export function AgentFlow({ run, n }: { run: AgentRun; n: AppNotification }) {
  const { tokens, emit, done } = useFlowTokens();
  const tabs = useTerminal((s) => s.tabs);
  const activate = useTerminal((s) => s.activate);
  const setOpen = useTerminal((s) => s.setOpen);
  const tab = tabs.find((t) => t.notificationId === n.id);
  const working = isActive(run.status);

  // One token per status transition; the working state keeps a chip cycling
  // agent → workspace until the status changes.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (lastStatus.current === run.status) return;
    lastStatus.current = run.status;
    const chip = (label: string, color: string) => <FlowChip icon={<Sparkles size={10} />} label={label} color={color} />;
    const loop = () => {
      const cur = useAgents.getState().runs[n.id];
      if (!cur || cur.id !== run.id || !isActive(cur.status)) return;
      emit({ edge: "e2", render: chip("working", "var(--src-agent)"), duration: 900, onArrive: loop });
    };
    switch (run.status) {
      case "starting":
        emit({ edge: "e1", render: chip("handoff", "var(--src-agent)"), duration: 700, onArrive: loop });
        break;
      case "working":
      case "thinking":
        loop();
        break;
      case "done":
        emit({ edge: "e3", render: chip("result", "var(--success)"), duration: 700 });
        break;
      case "failed":
        emit({ edge: "e3", render: chip("failed", "var(--danger)"), duration: 700 });
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status, run.id]);

  const openTerminal = tab
    ? () => {
        activate(tab.id);
        setOpen(true);
      }
    : undefined;

  const resultColor =
    run.status === "done" ? "var(--success)" : run.status === "failed" ? "var(--danger)" : run.status === "waiting" ? "var(--warning)" : "var(--ink-3)";
  const resultIcon =
    run.status === "done" ? (
      <CheckCircle2 size={15} />
    ) : run.status === "failed" ? (
      <XCircle size={15} />
    ) : run.status === "waiting" ? (
      <CirclePause size={15} />
    ) : (
      <GitPullRequest size={15} />
    );
  const resultLabel =
    run.status === "done" ? "Done" : run.status === "failed" ? "Failed" : run.status === "waiting" ? "Needs you" : "Result";

  const nodes = useMemo<FlowNode[]>(
    () => [
      {
        id: "item",
        x: X[0],
        ...NODE,
        render: <FlowBox icon={<SourceBadge source={n.source} size={12} n={n} />} label={n.meta?.number ?? n.meta?.key ?? "Item"} sub={n.source} size="sm" />,
      },
      {
        id: "agent",
        x: X[1],
        ...NODE,
        render: (
          <FlowBox
            icon={<Bot size={15} />}
            label={runnerLabel(run.runner)}
            sub={run.label}
            color="var(--src-agent)"
            pulse={run.status === "starting" || run.status === "waiting"}
            size="sm"
          />
        ),
      },
      {
        id: "work",
        x: X[2],
        ...NODE,
        title: tab ? "Open the agent's terminal" : undefined,
        onClick: openTerminal,
        render: (
          <FlowBox
            icon={working ? <Loader2 size={15} className="animate-spin" /> : <TerminalSquare size={15} />}
            label={run.runner === "orca" ? "Worktree" : run.runner === "desktop" ? "Claude app" : "Terminal"}
            sub={working ? "working…" : run.detail && run.status === "waiting" ? "paused" : tab ? "open" : "closed"}
            color="var(--accent)"
            dim={!working && run.status !== "waiting" && !tab}
            pulse={working}
            size="sm"
          />
        ),
      },
      {
        id: "result",
        x: X[3],
        ...NODE,
        render: <FlowBox icon={resultIcon} label={resultLabel} sub={run.status === "done" || run.status === "failed" ? run.detail ?? undefined : undefined} color={resultColor} dim={working || run.status === "starting"} size="sm" />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.status, run.detail, run.runner, run.label, n.id, tab?.id, working],
  );

  const edges = useMemo<FlowEdge[]>(
    () => [
      { id: "e1", from: "item", to: "agent", active: run.status === "starting" },
      { id: "e2", from: "agent", to: "work", active: working, dim: run.status === "failed" },
      { id: "e3", from: "work", to: "result", active: run.status === "done", dim: working || run.status === "starting" },
    ],
    [run.status, working],
  );

  return (
    <div className="mt-4 rounded-xl border border-src-agent/20 bg-src-agent/5 px-3 pt-1 pb-2">
      <FlowStage width={W} height={H} nodes={nodes} edges={edges} tokens={tokens} onTokenDone={done} />
    </div>
  );
}
