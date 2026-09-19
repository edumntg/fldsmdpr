import { useEffect, useMemo, useRef } from "react";
import { GitPullRequest, MessageSquare, CircleDot, Flame, Calendar, Sparkles, KeyRound, Inbox } from "lucide-react";
import { FlowStage, FlowBox, FlowChip, useFlowTokens, type FlowNode, type FlowEdge } from "../../components/flow/FlowStage";
import { useConnections } from "../../stores/connections";
import { useSlackAi } from "../../stores/slackAi";
import { useJev } from "../../stores/jev";
import type { Source } from "../../lib/types";

const W = 600;
const H = 168;

type Row = { id: Source | "jev"; label: string; icon: typeof Inbox; color: string };
const ROWS: Row[] = [
  { id: "github", label: "GitHub", icon: GitPullRequest, color: "var(--src-github)" },
  { id: "slack", label: "Slack", icon: MessageSquare, color: "var(--src-slack)" },
  { id: "linear", label: "Linear", icon: CircleDot, color: "var(--src-linear)" },
  { id: "sentry", label: "Sentry", icon: Flame, color: "var(--src-sentry)" },
  { id: "gcal", label: "Calendar", icon: Calendar, color: "var(--src-gcal)" },
  { id: "jev", label: "AI triage", icon: Sparkles, color: "var(--src-agent)" },
];

/**
 * The setup guide's live map: each tool lights up as you connect it and a
 * chip rides into the inbox; the middle node is the point of the whole app —
 * tokens stay in your keychain, data in a local SQLite file, nothing in between.
 * `current` highlights the step you're on.
 */
export function OnboardingFlow({ current }: { current: string | null }) {
  const statuses = useConnections((s) => s.statuses);
  const slackEnabled = useSlackAi((s) => s.enabled);
  const jevConnected = useJev((s) => s.connected);
  const { tokens, emit, done } = useFlowTokens();

  const on = (id: Row["id"]) =>
    id === "jev" ? jevConnected : id === "slack" ? slackEnabled || statuses.some((s) => s.id === "slack" && s.connected) : statuses.some((s) => s.id === id && s.connected);

  // A newly connected tool sends one chip through the pipeline.
  const prev = useRef<Record<string, boolean> | null>(null);
  useEffect(() => {
    const now: Record<string, boolean> = Object.fromEntries(ROWS.map((r) => [r.id, on(r.id)]));
    if (prev.current) {
      for (const r of ROWS) {
        if (now[r.id] && !prev.current[r.id]) {
          const Icon = r.icon;
          const chip = <FlowChip icon={<Icon size={10} />} label={r.label} color={r.color} />;
          emit({ edge: `e-${r.id}`, render: chip, duration: 700, onArrive: () => emit({ edge: "e-inbox", render: chip, duration: 600 }) });
        }
      }
    }
    prev.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, slackEnabled, jevConnected]);

  const nodes = useMemo<FlowNode[]>(() => {
    const out: FlowNode[] = ROWS.map((r, i) => {
      const Icon = r.icon;
      const col = i < 3 ? 0 : 1; // two columns of three
      return {
        id: r.id,
        x: col * 128,
        y: 8 + (i % 3) * 52,
        w: 118,
        h: 40,
        render: <FlowBox icon={<Icon size={13} />} label={r.label} color={r.color} dim={!on(r.id)} selected={current === r.id} size="sm" />,
      };
    });
    out.push({
      id: "local",
      x: 300,
      y: 44,
      w: 150,
      h: 76,
      render: <FlowBox icon={<KeyRound size={14} />} label="Your Mac" sub="Keychain + local SQLite" color="var(--accent)" size="sm" />,
    });
    out.push({
      id: "inbox",
      x: 500,
      y: 58,
      w: 100,
      h: 48,
      render: <FlowBox icon={<Inbox size={14} />} label="Inbox" color="var(--ink)" size="sm" />,
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, slackEnabled, jevConnected, current]);

  const edges = useMemo<FlowEdge[]>(
    () => [...ROWS.map((r) => ({ id: `e-${r.id}`, from: r.id, to: "local", dim: !on(r.id), active: current === r.id })), { id: "e-inbox", from: "local", to: "inbox" }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statuses, slackEnabled, jevConnected, current],
  );

  return <FlowStage width={W} height={H} nodes={nodes} edges={edges} tokens={tokens} onTokenDone={done} />;
}
