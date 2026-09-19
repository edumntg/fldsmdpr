import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Interactive flow diagrams (PlanetScale-style): a fixed-coordinate stage that
 * scales to its container, HTML nodes, one SVG of curved edges underneath, and
 * "tokens" — small chips that travel along an edge with a pure-CSS motion
 * path animation. No graph library, no JS animation loop.
 */

export interface FlowNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  render: ReactNode;
  onClick?: () => void;
  title?: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** Faded edge (source disabled, path not in use). */
  dim?: boolean;
  /** Highlighted edge (e.g. while its source syncs). */
  active?: boolean;
  /** Optional midpoint label (e.g. a probability). */
  label?: string;
}

export interface FlowToken {
  key: string;
  edge: string;
  render: ReactNode;
  /** Travel time in ms at 1× speed (scaled by --flow-speed). */
  duration?: number;
  onArrive?: () => void;
}

type Pt = { x: number; y: number };

/** Anchor on the side of `a` facing `b` (horizontal when mostly side by side). */
function anchor(a: FlowNode, b: FlowNode): Pt {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? a.x + a.w : a.x, y: ca.y };
  return { x: ca.x, y: dy >= 0 ? a.y + a.h : a.y };
}

/** Cubic path between two nodes; the control points keep the curve gentle. */
export function edgePath(from: FlowNode, to: FlowNode): string {
  const p1 = anchor(from, to);
  const p2 = anchor(to, from);
  const horizontal = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y);
  const k = horizontal ? (p2.x - p1.x) / 2 : 0;
  const j = horizontal ? 0 : (p2.y - p1.y) / 2;
  return `M ${p1.x} ${p1.y} C ${p1.x + k} ${p1.y + j}, ${p2.x - k} ${p2.y - j}, ${p2.x} ${p2.y}`;
}

export function FlowStage({
  width,
  height,
  nodes,
  edges,
  tokens,
  onTokenDone,
  className,
}: {
  width: number;
  height: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  tokens: FlowToken[];
  onTokenDone: (key: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Fit the fixed-coordinate stage to the container width.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1.25, e.contentRect.width / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const paths = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (a && b) m.set(e.id, edgePath(a, b));
    }
    return m;
  }, [edges, byId]);

  return (
    <div ref={ref} className={cn("relative w-full select-none", className)} style={{ height: height * scale }}>
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width, height, transform: `scale(${scale})` }}
      >
        <svg width={width} height={height} className="absolute inset-0 overflow-visible">
          {edges.map((e) => {
            const d = paths.get(e.id);
            if (!d) return null;
            return (
              <g key={e.id}>
                <path
                  d={d}
                  fill="none"
                  strokeWidth={e.active ? 2.5 : 1.75}
                  className={cn(
                    "transition-[stroke,opacity] duration-300",
                    e.active ? "stroke-accent" : "stroke-line-strong",
                    e.dim && "opacity-30",
                  )}
                  strokeDasharray={e.dim ? "4 6" : undefined}
                />
                {e.label && <EdgeLabel d={d} text={e.label} />}
              </g>
            );
          })}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            title={n.title}
            onClick={n.onClick}
            className={cn("absolute", n.onClick && "cursor-default")}
            style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
          >
            {n.render}
          </div>
        ))}

        {tokens.map((t) => {
          const d = paths.get(t.edge);
          if (!d) return null;
          return (
            <div
              key={t.key}
              onAnimationEnd={() => {
                t.onArrive?.();
                onTokenDone(t.key);
              }}
              className="flow-token pointer-events-none absolute top-0 left-0"
              style={
                {
                  offsetPath: `path("${d}")`,
                  "--dur": `calc(${t.duration ?? 700}ms / var(--flow-speed, 1))`,
                } as CSSProperties
              }
            >
              {t.render}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Text sitting on the midpoint of a path (measured once via SVG APIs). */
function EdgeLabel({ d, text }: { d: string; text: string }) {
  const ref = useRef<SVGPathElement>(null);
  const [pt, setPt] = useState<Pt | null>(null);
  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const mid = p.getPointAtLength(p.getTotalLength() / 2);
    setPt({ x: mid.x, y: mid.y });
  }, [d]);
  return (
    <>
      <path ref={ref} d={d} fill="none" stroke="none" />
      {pt && (
        <g transform={`translate(${pt.x} ${pt.y})`}>
          <rect x={-18} y={-9} width={36} height={18} rx={9} className="fill-surface-2 stroke-line" />
          <text textAnchor="middle" dominantBaseline="middle" className="fill-ink-2 text-[10px] font-semibold">
            {text}
          </text>
        </g>
      )}
    </>
  );
}

/** Standard node box: icon, label, optional sublabel and count, tinted by a CSS color. */
export function FlowBox({
  icon,
  label,
  sub,
  count,
  color,
  dim,
  pulse,
  selected,
  size = "md",
}: {
  icon?: ReactNode;
  label: string;
  sub?: string;
  count?: number;
  /** Any CSS color (e.g. `var(--src-github)`). */
  color?: string;
  dim?: boolean;
  pulse?: boolean;
  selected?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "press flex h-full w-full items-center gap-2.5 rounded-xl border bg-surface-2 shadow-card transition-[opacity,box-shadow,border-color] duration-300",
        size === "md" ? "px-3" : "px-2.5",
        dim ? "opacity-40 grayscale" : "hover:shadow-card-hover",
        selected && "ring-2 ring-accent/30",
        pulse && "animate-flow-pulse",
      )}
      style={{ borderColor: color ? `color-mix(in srgb, ${color} 55%, transparent)` : undefined }}
    >
      {icon && (
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={{ color, backgroundColor: color ? `color-mix(in srgb, ${color} 14%, transparent)` : undefined }}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-semibold", size === "md" ? "text-[13px]" : "text-[12px]")}>{label}</span>
        {sub && <span className="block truncate text-[11px] text-ink-3">{sub}</span>}
      </span>
      {count !== undefined && count > 0 && (
        <span
          className="shrink-0 rounded-pill px-1.5 py-px text-[10.5px] font-semibold tabular-nums"
          style={{ color, backgroundColor: color ? `color-mix(in srgb, ${color} 14%, transparent)` : undefined }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

/** The chip that travels along an edge. */
export function FlowChip({ icon, label, color }: { icon?: ReactNode; label?: string; color?: string }) {
  return (
    <span
      className="flex items-center gap-1 rounded-pill border bg-surface-2 py-0.5 pr-2 pl-1 text-[10.5px] font-medium shadow-pop"
      style={{ color, borderColor: color ? `color-mix(in srgb, ${color} 55%, transparent)` : undefined }}
    >
      {icon && <span className="flex size-4 items-center justify-center">{icon}</span>}
      {label && <span className="max-w-28 truncate">{label}</span>}
    </span>
  );
}

/** Token queue: `emit` adds a token, `done` removes it once it arrives. */
export function useFlowTokens() {
  const [tokens, setTokens] = useState<FlowToken[]>([]);
  const seq = useRef(0);
  const emit = (t: Omit<FlowToken, "key">) => {
    const key = `t${seq.current++}`;
    // ponytail: cap at 40 in flight — a huge first sync shouldn't snow the stage
    setTokens((ts) => [...ts.slice(-39), { ...t, key }]);
    return key;
  };
  const done = (key: string) => setTokens((ts) => ts.filter((t) => t.key !== key));
  return { tokens, emit, done };
}
