import { useEffect, useMemo, useRef } from "react";
import {
  GitPullRequest,
  CircleDot,
  Flame,
  MessageSquare,
  Calendar,
  FileText,
  NotebookPen,
  RefreshCw,
  Sparkles,
  Inbox,
  Play,
  Gauge,
} from "lucide-react";
import { FlowStage, FlowBox, FlowChip, useFlowTokens, type FlowNode, type FlowEdge } from "../../components/flow/FlowStage";
import { useInbox } from "../../stores/inbox";
import { useUi } from "../../stores/ui";
import { useSync } from "../../stores/sync";
import { useConnections } from "../../stores/connections";
import { useAiSources } from "../../stores/aiSources";
import { useSlackAi } from "../../stores/slackAi";
import { useJev } from "../../stores/jev";
import { useTheme, FLOW_SPEEDS } from "../../stores/theme";
import type { AppNotification, SectionId, Source } from "../../lib/types";
import { cn, relativeTime } from "../../lib/utils";
import { Button } from "../../components/ui/Button";
import { JEV_URGENCY_LABEL } from "../../lib/actions";

const W = 900;
const H = 520;

interface SourceDef {
  id: Source;
  label: string;
  icon: typeof Inbox;
  color: string;
  section: SectionId;
}

const SOURCES: SourceDef[] = [
  { id: "github", label: "GitHub", icon: GitPullRequest, color: "var(--src-github)", section: "prs" },
  { id: "linear", label: "Linear", icon: CircleDot, color: "var(--src-linear)", section: "tickets" },
  { id: "sentry", label: "Sentry", icon: Flame, color: "var(--src-sentry)", section: "errors" },
  { id: "slack", label: "Slack", icon: MessageSquare, color: "var(--src-slack)", section: "slack" },
  { id: "gcal", label: "Calendar", icon: Calendar, color: "var(--src-gcal)", section: "calendar" },
  { id: "notion", label: "Notion", icon: FileText, color: "var(--src-notion)", section: "inbox" },
  { id: "granola", label: "Granola", icon: NotebookPen, color: "var(--src-granola)", section: "meetings" },
];

type Tray = "urgent" | "today" | "this_week" | "fyi";
const TRAYS: { id: Tray; color: string }[] = [
  { id: "urgent", color: "var(--danger)" },
  { id: "today", color: "var(--warning)" },
  { id: "this_week", color: "var(--accent)" },
  { id: "fyi", color: "var(--ink-3)" },
];

/** Where an item lands: Jev's urgency when judged, else the connector's priority band. */
export function trayOf(n: AppNotification): Tray {
  const u = n.meta?.jev_urgency as Tray | undefined;
  if (u && n.meta?.jev_priority) return u;
  if (n.priority >= 90) return "urgent";
  if (n.priority >= 75) return "today";
  if (n.priority >= 55) return "this_week";
  return "fyi";
}

export function FlowView() {
  const items = useInbox((s) => s.items);
  const setSection = useUi((s) => s.setSection);
  const select = useUi((s) => s.select);
  const { syncing, lastSyncAt, lastError, sync } = useSync();
  const statuses = useConnections((s) => s.statuses);
  const aiSources = useAiSources((s) => s.sources);
  const slackEnabled = useSlackAi((s) => s.enabled);
  const jev = useJev();
  const flowSpeed = useTheme((s) => s.flowSpeed);
  const setFlowSpeed = useTheme((s) => s.setFlowSpeed);
  const { tokens, emit, done } = useFlowTokens();

  const connected = (id: Source) =>
    id === "notion" || id === "granola"
      ? aiSources[id].enabled
      : id === "slack"
        ? slackEnabled
        : statuses.some((s) => s.id === id && s.connected);

  const active = items.filter((n) => n.state !== "done");
  const perSource = new Map<Source, number>();
  const perTray = new Map<Tray, number>();
  for (const n of active) {
    if (n.state !== "unread") continue;
    perSource.set(n.source, (perSource.get(n.source) ?? 0) + 1);
    const t = trayOf(n);
    perTray.set(t, (perTray.get(t) ?? 0) + 1);
  }

  /** Animate one item through the pipeline: source → sync → triage → tray. */
  const travel = (n: AppNotification, delay = 0) => {
    const src = SOURCES.find((s) => s.id === n.source);
    if (!src) return;
    const Icon = src.icon;
    const chip = <FlowChip icon={<Icon size={11} />} label={n.title} color={src.color} />;
    const tray = trayOf(n);
    setTimeout(() => {
      emit({
        edge: `e-${src.id}`,
        render: chip,
        duration: 800,
        onArrive: () =>
          emit({
            edge: "e-sync-jev",
            render: chip,
            duration: 500,
            onArrive: () => emit({ edge: `e-jev-${tray}`, render: chip, duration: 650 }),
          }),
      });
    }, delay);
  };

  // New items after a sync ride the pipeline live.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.filter((n) => !seen.current!.has(n.id));
    fresh.slice(0, 12).forEach((n, i) => travel(n, i * 120));
    for (const n of items) seen.current.add(n.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const replay = () => {
    [...active]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8)
      .forEach((n, i) => travel(n, i * 160));
  };

  const nodes = useMemo<FlowNode[]>(() => {
    const out: FlowNode[] = SOURCES.map((s, i) => {
      const Icon = s.icon;
      const on = connected(s.id);
      return {
        id: s.id,
        x: 30,
        y: 30 + i * 66,
        w: 180,
        h: 48,
        title: on ? `Open ${s.label}` : `Connect ${s.label} in Settings`,
        onClick: () => setSection(on ? s.section : "settings"),
        render: (
          <FlowBox
            icon={<Icon size={15} />}
            label={s.label}
            sub={on ? undefined : "not connected"}
            count={perSource.get(s.id)}
            color={s.color}
            dim={!on}
            pulse={syncing && on}
          />
        ),
      };
    });
    out.push({
      id: "sync",
      x: 340,
      y: 206,
      w: 170,
      h: 96,
      title: "Refresh now",
      onClick: () => void sync(),
      render: (
        <FlowBox
          icon={<RefreshCw size={16} className={cn(syncing && "animate-spin")} />}
          label={syncing ? "Syncing…" : "Sync"}
          sub={lastError ? "last run had errors" : lastSyncAt ? `updated ${relativeTime(lastSyncAt)}` : "every 60 s while focused"}
          color={lastError ? "var(--danger)" : "var(--accent)"}
          pulse={syncing}
        />
      ),
    });
    out.push({
      id: "jev",
      x: 560,
      y: 206,
      w: 170,
      h: 96,
      title: jev.connected ? "AI triage settings" : "Connect AI triage in Settings",
      onClick: () => setSection("settings"),
      render: (
        <FlowBox
          icon={<Sparkles size={16} />}
          label="AI triage"
          sub={jev.connected ? (jev.enabled ? `${jev.judged} judged` : "paused") : "off · connector priorities"}
          color="var(--src-agent)"
          dim={!jev.connected || !jev.enabled}
          pulse={jev.running}
        />
      ),
    });
    TRAYS.forEach((t, i) => {
      out.push({
        id: `tray-${t.id}`,
        x: 780,
        y: 44 + i * 112,
        w: 100,
        h: 72,
        title: `Open inbox · ${JEV_URGENCY_LABEL[t.id]}`,
        onClick: () => {
          setSection("inbox");
          const first = active.filter((n) => trayOf(n) === t.id).sort((a, b) => b.priority - a.priority)[0];
          if (first) select(first.id);
        },
        render: <FlowBox label={JEV_URGENCY_LABEL[t.id]} count={perTray.get(t.id)} color={t.color} size="sm" />,
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, statuses, aiSources, slackEnabled, syncing, lastSyncAt, lastError, jev.connected, jev.enabled, jev.running, jev.judged]);

  const edges = useMemo<FlowEdge[]>(
    () => [
      ...SOURCES.map((s) => ({ id: `e-${s.id}`, from: s.id, to: "sync", dim: !connected(s.id), active: syncing && connected(s.id) })),
      { id: "e-sync-jev", from: "sync", to: "jev", dim: !jev.connected || !jev.enabled, active: jev.running },
      ...TRAYS.map((t) => ({ id: `e-jev-${t.id}`, from: "jev", to: `tray-${t.id}` })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statuses, aiSources, slackEnabled, syncing, jev.connected, jev.enabled, jev.running],
  );

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center gap-2 px-5">
        <h1 className="text-[15px] font-semibold tracking-tight">Flow</h1>
        <span className="text-xs text-ink-3">— how items reach your inbox, live</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-0.5">
            <Gauge size={13} className="ml-1.5 text-ink-3" />
            {FLOW_SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setFlowSpeed(s)}
                className={cn(
                  "press cursor-default rounded-lg px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                  flowSpeed === s ? "bg-accent text-accent-fg" : "text-ink-2 hover:bg-surface-3",
                )}
              >
                {s}×
              </button>
            ))}
          </span>
          <Button size="sm" variant="secondary" onClick={replay} disabled={active.length === 0}>
            <Play size={12} />
            Replay latest
          </Button>
          <Button size="sm" variant="primary" onClick={() => void sync()} disabled={syncing}>
            <RefreshCw size={12} className={cn(syncing && "animate-spin")} />
            Sync now
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5 pt-1">
        <div className="mx-auto max-w-5xl">
          <div className="animate-pop-in rounded-card border border-line bg-surface-2/60 p-4 shadow-card">
            <FlowStage width={W} height={H} nodes={nodes} edges={edges} tokens={tokens} onTokenDone={done} />
          </div>
          <p className="mt-3 text-center text-xs text-ink-3">
            Connected sources feed the sync every minute. With AI triage on, each new item is judged and
            lands in an urgency tray; otherwise the connector's own priority decides. Click a source to
            open it, a tray to jump to its top item.
          </p>
        </div>
      </div>
    </section>
  );
}
