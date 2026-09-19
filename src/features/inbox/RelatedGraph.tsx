import { useEffect, useMemo, useRef } from "react";
import { Link2 } from "lucide-react";
import { FlowStage, FlowBox, FlowChip, useFlowTokens, type FlowNode, type FlowEdge } from "../../components/flow/FlowStage";
import { SourceBadge, sourceLabel } from "../../components/ui/SourceBadge";
import { useInbox } from "../../stores/inbox";
import { useUi } from "../../stores/ui";
import type { AppNotification } from "../../lib/types";

export interface RelatedRef {
  id: string;
  title: string;
  p: string;
}

const W = 560;
const CENTER = { x: 0, w: 150, h: 56 };
const SIDE = { x: 300, w: 260, h: 48 };
const GAP = 58;

/**
 * The item in the middle, the PRs/tickets Jev judged related fanned out to
 * the right, each edge labelled with the probability. Clicking a related
 * node opens it; a chip travels along the edge on mount as a "here's the
 * link" cue.
 */
export function RelatedGraph({ n, related }: { n: AppNotification; related: RelatedRef[] }) {
  const items = useInbox((s) => s.items);
  const select = useUi((s) => s.select);
  const { tokens, emit, done } = useFlowTokens();

  const rows = related.slice(0, 6);
  const H = Math.max(CENTER.h + 16, rows.length * GAP + 8);

  const nodes = useMemo<FlowNode[]>(() => {
    const out: FlowNode[] = [
      {
        id: "self",
        x: CENTER.x,
        y: (H - CENTER.h) / 2,
        w: CENTER.w,
        h: CENTER.h,
        render: (
          <FlowBox
            icon={<SourceBadge source={n.source} size={12} n={n} />}
            label={n.meta?.number ?? n.meta?.key ?? sourceLabel(n.source)}
            sub="this item"
            color={`var(--src-${n.source})`}
            size="sm"
          />
        ),
      },
    ];
    rows.forEach((r, i) => {
      const target = items.find((it) => it.id === r.id);
      const src = target?.source ?? "linear";
      out.push({
        id: r.id,
        x: SIDE.x,
        y: 4 + i * GAP,
        w: SIDE.w,
        h: SIDE.h,
        title: target ? "Open" : "No longer in the inbox",
        onClick: target ? () => select(target.id) : undefined,
        render: (
          <FlowBox
            icon={target ? <SourceBadge source={src} size={12} n={target} /> : <Link2 size={13} />}
            label={r.title}
            sub={target ? (target.meta?.number ?? target.meta?.key ?? sourceLabel(src)) : "archived"}
            color={`var(--src-${src})`}
            dim={!target}
            size="sm"
          />
        ),
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id, related, items]);

  const edges = useMemo<FlowEdge[]>(
    () => rows.map((r) => ({ id: `r-${r.id}`, from: "self", to: r.id, label: `${Math.round(Number(r.p) * 100)}%` })),
    [rows],
  );

  // Cue: one chip per link, staggered, when the graph appears for an item.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current === n.id) return;
    shown.current = n.id;
    rows.forEach((r, i) =>
      setTimeout(() => emit({ edge: `r-${r.id}`, render: <FlowChip icon={<Link2 size={10} />} color="var(--src-agent)" />, duration: 650 }), i * 140),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id]);

  if (rows.length === 0) return null;
  return <FlowStage width={W} height={H} nodes={nodes} edges={edges} tokens={tokens} onTokenDone={done} className="mt-2" />;
}
