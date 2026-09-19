import { useMemo, useState } from "react";
import { Sparkles, Play, Loader2, Inbox } from "lucide-react";
import { FlowStage, FlowBox, FlowChip, useFlowTokens, type FlowNode, type FlowEdge } from "../../components/flow/FlowStage";
import { useJev } from "../../stores/jev";
import { jevJudgeSamples, type JevSample, type JevVerdict } from "../../lib/ipc";
import { Button } from "../../components/ui/Button";
import { JEV_URGENCY_LABEL } from "../../lib/actions";
import { cn } from "../../lib/utils";

const W = 600;
const H = 250;

const SAMPLES: JevSample[] = [
  {
    source: "sentry",
    title: "TypeError in payments webhook — 142 events, production",
    body: "Cannot read properties of undefined (reading 'amount') at handleWebhook (src/payments/webhook.ts:84). 37 users affected in the last hour.",
  },
  {
    source: "github",
    title: "Review requested: Fix OAuth token refresh race",
    body: "A teammate asked for your review on core-api #482. 6 files changed. CI passing.",
  },
  {
    source: "linear",
    title: "PLA-360: Rename internal metrics labels",
    body: "Low priority cleanup for a future cycle. No deadline.",
  },
];

/** Canned answers so the playground still demonstrates the idea without a key. */
const DEMO: JevVerdict[] = [
  { urgency: "urgent", confidence: 0.91, needs_action: 0.94, action: "fix_bug" },
  { urgency: "today", confidence: 0.83, needs_action: 0.88, action: "review_code" },
  { urgency: "fyi", confidence: 0.77, needs_action: 0.12, action: "none" },
];

const TRAYS = [
  { id: "urgent", color: "var(--danger)" },
  { id: "today", color: "var(--warning)" },
  { id: "this_week", color: "var(--accent)" },
  { id: "fyi", color: "var(--ink-3)" },
] as const;

const SRC_COLOR: Record<string, string> = {
  sentry: "var(--src-sentry)",
  github: "var(--src-github)",
  linear: "var(--src-linear)",
  slack: "var(--src-slack)",
};

/**
 * "Judge a sample": three canned items go through Jev and land in the tray it
 * picks, with the verdict under each. Live when a key is connected, canned
 * otherwise — either way it shows what the triage does to your inbox.
 */
export function JevPlayground() {
  const connected = useJev((s) => s.connected && s.enabled);
  const { tokens, emit, done } = useFlowTokens();
  const [verdicts, setVerdicts] = useState<(JevVerdict | null)[]>([null, null, null]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setVerdicts([null, null, null]);
    let results = DEMO;
    let isLive = false;
    if (connected) {
      try {
        results = await jevJudgeSamples(SAMPLES);
        isLive = true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setLive(isLive);
    results.forEach((v, i) => {
      const s = SAMPLES[i];
      const chip = <FlowChip icon={<Sparkles size={10} />} label={s.title} color={SRC_COLOR[s.source]} />;
      setTimeout(() => {
        emit({
          edge: `in-${i}`,
          render: chip,
          duration: 650,
          onArrive: () =>
            emit({
              edge: `out-${v.urgency}`,
              render: chip,
              duration: 600,
              onArrive: () => setVerdicts((vs) => vs.map((x, j) => (j === i ? v : x))),
            }),
        });
      }, i * 260);
    });
    setBusy(false);
  };

  const nodes = useMemo<FlowNode[]>(() => {
    const out: FlowNode[] = SAMPLES.map((s, i) => ({
      id: `s-${i}`,
      x: 0,
      y: 10 + i * 78,
      w: 200,
      h: 60,
      render: (
        <FlowBox
          icon={<Inbox size={13} />}
          label={s.title}
          sub={verdicts[i] ? `${JEV_URGENCY_LABEL[verdicts[i]!.urgency] ?? verdicts[i]!.urgency} · ${Math.round(verdicts[i]!.confidence * 100)}% · needs you ${Math.round(verdicts[i]!.needs_action * 100)}%` : s.source}
          color={SRC_COLOR[s.source]}
          size="sm"
        />
      ),
    }));
    out.push({
      id: "jev",
      x: 250,
      y: 89,
      w: 130,
      h: 72,
      render: <FlowBox icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} label="Jev" sub={connected ? "live" : "demo answers"} color="var(--src-agent)" pulse={busy} size="sm" />,
    });
    TRAYS.forEach((t, i) => {
      out.push({
        id: `tray-${t.id}`,
        x: 480,
        y: 6 + i * 60,
        w: 120,
        h: 46,
        render: <FlowBox label={JEV_URGENCY_LABEL[t.id]} count={verdicts.filter((v) => v?.urgency === t.id).length} color={t.color} size="sm" />,
      });
    });
    return out;
  }, [verdicts, busy, connected]);

  const edges = useMemo<FlowEdge[]>(
    () => [
      ...SAMPLES.map((_, i) => ({ id: `in-${i}`, from: `s-${i}`, to: "jev" })),
      ...TRAYS.map((t) => ({ id: `out-${t.id}`, from: "jev", to: `tray-${t.id}` })),
    ],
    [],
  );

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-medium">Try it</p>
        <span className="text-xs text-ink-3">three sample items, judged and routed</span>
        <div className="ml-auto flex items-center gap-2">
          {live && <span className="text-[11px] text-success">live answers</span>}
          {!connected && <span className="text-[11px] text-ink-3">connect a key for live answers</span>}
          <Button size="sm" variant="secondary" onClick={() => void run()} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Judge samples
          </Button>
        </div>
      </div>
      <FlowStage width={W} height={H} nodes={nodes} edges={edges} tokens={tokens} onTokenDone={done} className={cn("mt-2", busy && "opacity-90")} />
      {error && <p className="mt-1 text-xs text-danger">{error} — showing demo answers.</p>}
    </div>
  );
}
