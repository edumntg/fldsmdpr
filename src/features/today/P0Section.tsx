import { Siren, Sparkles, ArrowRight } from "lucide-react";
import { useUi, P0_WINDOW_LABELS, type P0Window } from "../../stores/ui";
import { useJev } from "../../stores/jev";
import { inRange } from "../../stores/inbox";
import { involvesMe } from "../../lib/involves";
import type { AppNotification } from "../../lib/types";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { Chip } from "../../components/ui/Chip";
import { JEV_URGENCY_LABEL, defaultAction } from "../../lib/actions";
import { cn, relativeTime } from "../../lib/utils";

const attack = (n: AppNotification) => Number(n.meta?.jev_attack ?? -1);
const needs = (n: AppNotification) => Number(n.meta?.jev_needs_action ?? 0);

/** Compact context line: where the item lives and who it comes from. */
function contextOf(n: AppNotification): string[] {
  const m = n.meta ?? {};
  const out: string[] = [];
  if (m.repo) out.push(m.number ? `${m.repo} ${m.number}` : m.repo);
  if (m.key && !m.number) out.push(m.key);
  if (m.project && !m.repo) out.push(m.project);
  if (m.channel) out.push(m.channel);
  if (m.from && m.from !== "You") out.push(`from ${m.from}`);
  if (m.author) out.push(`by ${m.author}`);
  if (m.state && n.source === "linear") out.push(m.state);
  if (m.level) out.push(m.level);
  return out.slice(0, 3);
}

/**
 * Jev's picks for right now. Only items about the user compete (deterministic,
 * see lib/involves.ts); every judged one carries an "attack now" score (0–4,
 * see jev.rs) that ranks them inside the chosen window. Without Jev the
 * connectors' priorities decide and the card says so.
 */
export function pickP0(items: AppNotification[], window: P0Window, count: number, showSentry: boolean) {
  const pool = items.filter(
    (n) =>
      n.state !== "done" &&
      n.source !== "gcal" &&
      n.type !== "agent_done" &&
      (showSentry || n.source !== "sentry") &&
      involvesMe(n) &&
      inRange(n, window === "today" ? "today" : "7d"),
  );
  const judged = pool.filter((n) => attack(n) >= 0);
  const byJev = judged.length > 0;
  const byPriority = (a: AppNotification, b: AppNotification) => b.priority - a.priority || b.createdAt - a.createdAt;
  // Jev-scored items rank by attack; unjudged ones (new since the last sync)
  // wait for their verdict rather than sneaking in.
  const ranked = byJev
    ? judged.sort((a, b) => attack(b) - attack(a) || needs(b) - needs(a) || b.priority - a.priority)
    : pool.sort(byPriority);
  return { picks: ranked.slice(0, count), byJev, poolSize: pool.length, pending: pool.length - judged.length };
}

export function P0Section({ items, goTo }: { items: AppNotification[]; goTo: (n: AppNotification) => void }) {
  const { p0Count, p0Window, setP0Window, showSentry } = useUi();
  const jevOn = useJev((s) => s.connected && s.enabled);
  const { picks, byJev, poolSize, pending } = pickP0(items, p0Window, p0Count, showSentry);

  return (
    <div className="animate-pop-in rounded-card border border-danger/25 bg-surface-2 p-5 shadow-card">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-lg bg-danger/12 text-danger">
          <Siren size={14} />
        </span>
        <h3 className="text-[13px] font-semibold">P0 · Urgent</h3>
        <span className="text-xs text-ink-3">
          {byJev
            ? `${Math.min(p0Count, poolSize - pending)} of ${poolSize} about you${pending > 0 ? ` · ${pending} awaiting Jev` : ""}`
            : jevOn
              ? `waiting for Jev's verdicts on ${poolSize}`
              : `top ${p0Count} of ${poolSize} by connector priority`}
        </span>
        <span className="ml-auto inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
          {(Object.keys(P0_WINDOW_LABELS) as P0Window[]).map((w) => (
            <button
              key={w}
              onClick={() => setP0Window(w)}
              className={cn(
                "press cursor-default rounded-md px-2 py-0.5 text-[11px] font-medium",
                p0Window === w ? "bg-accent text-accent-fg" : "text-ink-2 hover:bg-surface-3",
              )}
            >
              {P0_WINDOW_LABELS[w]}
            </button>
          ))}
        </span>
      </div>

      {picks.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          {byJev
            ? `Nothing about you ${p0Window === "today" ? "today" : "this week"}. Check Settings → About you if that seems off.`
            : `Nothing pressing ${p0Window === "today" ? "today" : "this week"}. Enjoy it.`}
        </p>
      ) : (
        <ol className="flex flex-col">
          {picks.map((n, i) => {
            const action = defaultAction(n);
            const urg = n.meta?.jev_urgency;
            return (
              <li key={n.id} className={cn(i > 0 && "border-t border-line")}>
                <button onClick={() => goTo(n)} className="group flex w-full cursor-default items-start gap-3 py-2.5 text-left">
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums",
                      i === 0 ? "bg-danger text-white" : "bg-danger/12 text-danger",
                    )}
                  >
                    {i + 1}
                  </span>
                  <SourceBadge source={n.source} size={13} n={n} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{n.title}</span>
                    {n.snippet && <span className="mt-0.5 line-clamp-2 text-xs leading-4.5 text-ink-2">{n.snippet}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-3">
                      {contextOf(n).map((c) => (
                        <Chip key={c}>{c}</Chip>
                      ))}
                      {byJev && attack(n) >= 0 && (
                        <Chip tone={attack(n) >= 3 ? "danger" : "warning"}>
                          <Sparkles size={9} />
                          attack {attack(n).toFixed(1)}/4
                        </Chip>
                      )}
                      {urg && JEV_URGENCY_LABEL[urg] && <span>{JEV_URGENCY_LABEL[urg]}</span>}
                      {byJev && attack(n) >= 0 && <span>· needs you {Math.round(needs(n) * 100)}%</span>}
                      {action && <span>· {action}</span>}
                      <span>· {relativeTime(n.createdAt)}</span>
                    </span>
                  </span>
                  <ArrowRight size={13} className="mt-1.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
