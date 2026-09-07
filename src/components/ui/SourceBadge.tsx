import { GitPullRequest, MessageSquare, CircleDot, Calendar, Bot } from "lucide-react";
import type { Source } from "../../lib/types";
import { cn } from "../../lib/utils";

const config: Record<Source, { icon: typeof Bot; label: string; color: string; bg: string }> = {
  github: { icon: GitPullRequest, label: "GitHub", color: "text-src-github", bg: "bg-src-github/12" },
  slack: { icon: MessageSquare, label: "Slack", color: "text-src-slack", bg: "bg-src-slack/12" },
  linear: { icon: CircleDot, label: "Linear", color: "text-src-linear", bg: "bg-src-linear/12" },
  gcal: { icon: Calendar, label: "Calendar", color: "text-src-gcal", bg: "bg-src-gcal/12" },
  agent: { icon: Bot, label: "Agent", color: "text-src-agent", bg: "bg-src-agent/12" },
};

export function SourceBadge({ source, size = 16 }: { source: Source; size?: number }) {
  const { icon: Icon, label, color, bg } = config[source];
  return (
    <span
      title={label}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg p-1.5", bg, color)}
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

export const sourceLabel = (s: Source) => config[s].label;
