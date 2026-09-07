import {
  Bot,
  Check,
  Clock,
  ExternalLink,
  MessageSquareReply,
  Sparkles,
  Wrench,
  MousePointerClick,
} from "lucide-react";
import { useInbox } from "../../stores/inbox";
import { useUi } from "../../stores/ui";
import type { AppNotification } from "../../lib/types";
import { relativeTime } from "../../lib/utils";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { SourceBadge, sourceLabel } from "../../components/ui/SourceBadge";
import { AgentRunButton } from "../agents/AgentRunButton";

/** Agent actions offered per notification type (wired to real sessions in Phase 4). */
function agentActions(n: AppNotification): { label: string; icon: typeof Bot }[] {
  switch (n.type) {
    case "pr_review":
      return [{ label: "Review with agent", icon: Bot }];
    case "pr_update":
      return [{ label: "Fix with agent", icon: Wrench }];
    case "mention":
    case "ai_inferred":
      return [{ label: "Draft reply", icon: MessageSquareReply }];
    case "ticket":
    case "assigned":
      return [{ label: "Run agent on this task", icon: Bot }];
    default:
      return [];
  }
}

export function NotificationDetail() {
  const selectedId = useUi((s) => s.selectedId);
  const items = useInbox((s) => s.items);
  const setState = useInbox((s) => s.setState);
  const select = useUi((s) => s.select);
  const n = items.find((i) => i.id === selectedId);

  if (!n) return <Placeholder />;

  const actions = agentActions(n);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center gap-2 px-5">
        {/* breadcrumb, ref: `My notebook › Meeting notes` */}
        <span className="text-[13px] text-ink-3">{sourceLabel(n.source)}</span>
        <span className="text-ink-3">›</span>
        <span className="truncate text-[13px] font-medium">{n.meta?.number ?? n.meta?.key ?? n.meta?.channel ?? "Detail"}</span>
      </header>

      <div className="flex-1 overflow-y-auto p-5 pt-1">
        <div className="animate-pop-in mx-auto max-w-2xl rounded-card border border-line bg-surface-2 p-6 shadow-card">
          <div className="flex items-start gap-3">
            <SourceBadge source={n.source} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] leading-6 font-semibold tracking-tight">{n.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                <span>{relativeTime(n.createdAt)}</span>
                {n.meta?.from && <span>· from {n.meta.from}</span>}
                {n.meta?.repo && <span>· {n.meta.repo}</span>}
                {n.meta?.cycle && <span>· {n.meta.cycle}</span>}
              </div>
            </div>
          </div>

          {n.relevance?.kind === "implicit" && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-src-agent/8 p-3 text-[13px]">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-src-agent" />
              <div>
                <p className="font-medium text-src-agent">Surfaced by AI triage</p>
                <p className="mt-0.5 text-ink-2">{n.relevance.reason}</p>
              </div>
            </div>
          )}

          <p className="mt-4 text-[13.5px] leading-6 whitespace-pre-wrap text-ink-2 select-text">
            {n.snippet}
          </p>

          <div className="mt-6 flex flex-wrap items-start gap-2 border-t border-line pt-4">
            {actions.map(({ label, icon }) => (
              <AgentRunButton key={label} n={n} label={label} icon={icon} />
            ))}
            {n.url && (
              <Button
                variant={n.source === "gcal" ? "primary" : "secondary"}
                onClick={() => open(n.url)}
              >
                <ExternalLink size={14} />
                {n.source === "gcal" ? "Join" : "Open"}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" title="Snooze">
                <Clock size={14} />
                Snooze
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setState(n.id, "done");
                  select(null);
                }}
              >
                <Check size={14} />
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

async function open(url?: string) {
  if (!url) return;
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}

function Placeholder() {
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header data-tauri-drag-region className="h-13 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-ink-3">
        <MousePointerClick size={26} strokeWidth={1.5} />
        <p className="text-[13px] font-medium">Select a notification</p>
        <p className="flex items-center gap-1 text-xs">
          Navigate with <Chip>j</Chip> <Chip>k</Chip> — actions appear here
        </p>
      </div>
    </section>
  );
}
