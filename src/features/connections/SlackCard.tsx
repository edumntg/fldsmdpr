import { useEffect } from "react";
import { useSlackAi } from "../../stores/slackAi";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { Chip } from "../../components/ui/Chip";
import { SlackConnectionCard } from "./SlackConnectionCard";

/**
 * Slack is opt-in: one master switch. Off → no Slack section, no analysis
 * rounds, no channel fetch. On → the full connection card appears below.
 */
export function SlackCard() {
  const { enabled, loaded, init, setEnabled, running } = useSlackAi();
  useEffect(() => {
    if (!loaded) void init();
  }, [loaded, init]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-card border border-line bg-surface-2 p-4 shadow-card">
        <div className="flex items-center gap-3">
          <SourceBadge source="slack" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold">Slack</span>
              {enabled ? <Chip tone="success">Enabled</Chip> : <Chip>Off</Chip>}
              {running && <Chip tone="ai">Analyzing…</Chip>}
            </div>
            <p className="mt-0.5 text-xs text-ink-3">
              Mentions, DMs and AI-flagged messages as inbox items, plus day/week summaries. Analysis
              rounds are slow (minutes), so it's off by default.
            </p>
          </div>
          <label className="flex shrink-0 cursor-default items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!loaded}
              onChange={(e) => void setEnabled(e.target.checked)}
              className="size-3.5 accent-accent"
            />
            Enabled
          </label>
        </div>
      </div>
      {enabled && <SlackConnectionCard />}
    </div>
  );
}
