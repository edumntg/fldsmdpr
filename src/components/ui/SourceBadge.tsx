import {
  GitPullRequest,
  GitMerge,
  CircleDot,
  MessageSquare,
  Calendar,
  Bot,
  FileText,
  NotebookPen,
  Flame,
} from "lucide-react";
import type { Source, AppNotification } from "../../lib/types";
import { cn } from "../../lib/utils";

const config: Record<Source, { icon: typeof Bot; label: string; color: string; bg: string }> = {
  github: { icon: GitPullRequest, label: "GitHub", color: "text-src-github", bg: "bg-src-github/12" },
  slack: { icon: MessageSquare, label: "Slack", color: "text-src-slack", bg: "bg-src-slack/12" },
  linear: { icon: CircleDot, label: "Linear", color: "text-src-linear", bg: "bg-src-linear/12" },
  gcal: { icon: Calendar, label: "Calendar", color: "text-src-gcal", bg: "bg-src-gcal/12" },
  agent: { icon: Bot, label: "Agent", color: "text-src-agent", bg: "bg-src-agent/12" },
  notion: { icon: FileText, label: "Notion", color: "text-src-notion", bg: "bg-src-notion/12" },
  granola: { icon: NotebookPen, label: "Meetings", color: "text-src-granola", bg: "bg-src-granola/12" },
  sentry: { icon: Flame, label: "Sentry", color: "text-src-sentry", bg: "bg-src-sentry/12" },
};

/** GitHub items pick icon (PR vs issue vs merged) and color (open=green,
 * merged=purple, closed=red) from their state so they read like GitHub. */
function githubVariant(n: AppNotification) {
  const isPr = n.meta?.is_pr !== "false";
  const state = n.meta?.state; // open | merged | closed
  if (state === "merged") return { icon: GitMerge, color: "text-src-github-merged", bg: "bg-src-github-merged/12" };
  if (state === "closed") return { icon: isPr ? GitPullRequest : CircleDot, color: "text-src-github-closed", bg: "bg-src-github-closed/12" };
  return { icon: isPr ? GitPullRequest : CircleDot, color: "text-src-github", bg: "bg-src-github/12" };
}

export function SourceBadge({
  source,
  size = 16,
  n,
}: {
  source: Source;
  size?: number;
  n?: AppNotification;
}) {
  const base = config[source];
  const v = source === "github" && n ? githubVariant(n) : base;
  const Icon = v.icon;
  return (
    <span
      title={base.label}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg p-1.5", v.bg, v.color)}
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

export const sourceLabel = (s: Source) => config[s].label;
