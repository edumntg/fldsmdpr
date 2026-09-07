import type { AppNotification } from "../../lib/types";

/** Fallback colors when Linear didn't provide the state's own color. */
function fallbackColor(state: string, type?: string): string {
  const s = state.toLowerCase();
  if (s.includes("block")) return "#ef4444"; // red
  if (s.includes("review")) return "#22c55e"; // green
  if (s.includes("progress") || type === "started") return "#eab308"; // yellow
  if (type === "completed") return "#8b5cf6";
  if (type === "canceled") return "#94a3b8";
  return "#8e8e98"; // todo/backlog gray
}

/** Linear status chip: colored dot (Linear's own state color) + state name. */
export function LinearStateChip({ n }: { n: AppNotification }) {
  const state = n.meta?.state;
  if (!state) return null;
  const color = n.meta?.state_color || fallbackColor(state, n.meta?.state_type);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {state}
    </span>
  );
}
