import {
  Bot,
  Check,
  Clock,
  ExternalLink,
  MessageSquareReply,
  Sparkles,
  Wrench,
  MousePointerClick,
  Loader2,
  Minus,
  X as XIcon,
  Send,
  UserRoundPlus,
  TerminalSquare,
  CircleDot,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useInbox } from "../../stores/inbox";
import { useUi } from "../../stores/ui";
import { useSync } from "../../stores/sync";
import { useTerminal } from "../../stores/terminal";
import {
  linearMeta,
  linearUpdateIssue,
  linearAddComment,
  type LinearTeamMeta,
} from "../../lib/ipc";
import {
  snoozeNotification,
  githubPrDetail,
  githubPrReview,
  githubPrMerge,
  type PrDetail,
} from "../../lib/ipc";
import type { AppNotification } from "../../lib/types";
import { relativeTime } from "../../lib/utils";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { SourceBadge, sourceLabel } from "../../components/ui/SourceBadge";
import { AgentRunButton } from "../agents/AgentRunButton";
import { AgentStatusPanel } from "../agents/AgentStatusRow";
import { useAgents } from "../../stores/agents";
import { Collapsible } from "../../components/ui/Collapsible";
import { Markdown } from "../../components/ui/Markdown";
import { SentrySections } from "./SentrySections";
import { GranolaSections } from "./GranolaSections";
import { CreateTicketButton } from "./CreateTicketModal";
import { LinearStateChip } from "../../components/ui/LinearStateChip";

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
    case "action_item":
      return [{ label: "Run agent on this task", icon: Bot }];
    case "incident":
      return [{ label: "Fix with agent", icon: Wrench }];
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
  const agentRun = useAgents((s) => (n ? s.runs[n.id] : undefined));

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
            <SourceBadge source={n.source} n={n} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] leading-6 font-semibold tracking-tight">{n.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                <span>{relativeTime(n.createdAt)}</span>
                {n.meta?.from && <span>· from {n.meta.from}</span>}
                {n.meta?.repo && <span>· {n.meta.repo}</span>}
                {n.meta?.cycle && <span>· {n.meta.cycle}</span>}
                {n.meta?.team && <span>· {n.meta.team}</span>}
                {n.source === "linear" && <LinearStateChip n={n} />}
                {n.meta?.linked_ticket && (
                  <button
                    onClick={() => void open(n.meta?.linked_ticket_url)}
                    className="inline-flex cursor-default items-center gap-1 rounded-pill bg-src-linear/12 px-1.5 py-0.5 text-[10.5px] font-medium text-src-linear hover:underline"
                  >
                    <CircleDot size={10} />
                    {n.meta.linked_ticket}
                  </button>
                )}
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

          <Markdown className="mt-4">{n.snippet}</Markdown>

          {n.source === "linear" && <LinearSections n={n} />}

          {n.source === "github" && n.meta?.is_pr !== "false" && <PrSections n={n} />}

          {n.source === "sentry" && <SentrySections n={n} />}

          {n.source === "granola" && <GranolaSections n={n} />}

          {agentRun && <AgentStatusPanel run={agentRun} />}

          <div className="mt-6 flex flex-wrap items-start gap-2 border-t border-line pt-4">
            {actions.map(({ label, icon }) => (
              <AgentRunButton key={label} n={n} label={label} icon={icon} />
            ))}
            {(n.source === "sentry" || n.source === "slack") && <CreateTicketButton n={n} />}
            {n.source === "agent" && <OpenAgentTerminal n={n} />}
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
              <SnoozeButton n={n} onSnoozed={() => select(null)} />
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

function SnoozeButton({ n, onSnoozed }: { n: AppNotification; onSnoozed: () => void }) {
  const [open, setOpen] = useState(false);
  const reload = useInbox((s) => s.reload);

  const snooze = async (until: number) => {
    setOpen(false);
    await snoozeNotification(n.id, until);
    await reload();
    onSnoozed();
  };

  const tomorrow9 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  };

  return (
    <div className="relative">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
        <Clock size={14} />
        Snooze
      </Button>
      {open && (
        <div className="animate-pop-in absolute right-0 bottom-full z-30 mb-1.5 w-44 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-pop">
          {[
            { label: "In 1 hour", until: () => Date.now() + 3600_000 },
            { label: "In 4 hours", until: () => Date.now() + 4 * 3600_000 },
            { label: "Tomorrow 9 AM", until: tomorrow9 },
          ].map((o) => (
            <button
              key={o.label}
              onClick={() => void snooze(o.until())}
              className="flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-3"
            >
              <Clock size={12} className="shrink-0 text-ink-3" />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** PR description, branch/commit stats, and the changed files with diffs —
 * fetched on demand from the GitHub API when the PR is opened. */
function PrSections({ n }: { n: AppNotification }) {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repo = n.meta?.repo;
  const number = Number((n.meta?.number ?? "").replace("#", ""));

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!repo || !number) return;
    let cancelled = false;
    githubPrDetail(repo, number)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [repo, number, n.id]);

  if (!repo || !number) return null;
  if (error) return <p className="mt-3 text-xs text-ink-3">Couldn't load PR details: {error}</p>;
  if (!detail) return <p className="mt-3 text-xs text-ink-3">Loading PR details…</p>;

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        <span className="font-mono">
          {detail.head} → {detail.base}
        </span>
        <span>
          <span className="font-medium text-success">+{detail.additions}</span>{" "}
          <span className="font-medium text-danger">−{detail.deletions}</span>
        </span>
        <span>
          {detail.changed_files} {detail.changed_files === 1 ? "file" : "files"} · {detail.commits}{" "}
          {detail.commits === 1 ? "commit" : "commits"}
        </span>
      </div>

      {detail.body.trim() && (
        <Collapsible title="Description" defaultOpen>
          <Markdown className="text-[13px]">{detail.body.trim()}</Markdown>
        </Collapsible>
      )}

      {detail.checks.length > 0 && <PrChecks checks={detail.checks} />}

      <Collapsible title={`Files changed (${detail.changed_files})`} defaultOpen>
        <div className="flex flex-col gap-1.5">
          {detail.files.map((f) => (
            <PrFileRow key={f.filename} f={f} />
          ))}
          {detail.truncated && (
            <p className="text-xs text-ink-3">
              Showing the first {detail.files.length} files — open the PR for the rest.
            </p>
          )}
        </div>
      </Collapsible>

      {detail.state === "open" && !detail.merged && (
        <PrActions repo={repo} number={number} mergeableState={detail.mergeable_state} draft={detail.draft} />
      )}
    </div>
  );
}

function checkIcon(c: PrDetail["checks"][number]) {
  if (c.status !== "completed")
    return <Loader2 size={12} className="animate-spin text-warning" />;
  if (c.conclusion === "success") return <Check size={12} className="text-success" />;
  if (c.conclusion === "skipped" || c.conclusion === "neutral")
    return <Minus size={12} className="text-ink-3" />;
  return <XIcon size={12} className="text-danger" />;
}

function PrChecks({ checks }: { checks: PrDetail["checks"] }) {
  const failing = checks.filter((c) => c.status === "completed" && !["success", "skipped", "neutral"].includes(c.conclusion));
  const running = checks.filter((c) => c.status !== "completed");
  const summary =
    failing.length > 0
      ? `${failing.length} failing`
      : running.length > 0
        ? `${running.length} running`
        : "all passing";
  return (
    <Collapsible
      title={`CI checks (${checks.length}) — ${summary}`}
      defaultOpen={failing.length > 0}
    >
      <div className="flex flex-col gap-1">
        {checks.map((c, i) => (
          <button
            key={i}
            onClick={() => c.url && open(c.url)}
            className="flex w-full cursor-default items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-left hover:bg-surface-3"
          >
            {checkIcon(c)}
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{c.name}</span>
            <span className="shrink-0 text-[11px] text-ink-3">{c.conclusion || c.status}</span>
          </button>
        ))}
      </div>
    </Collapsible>
  );
}

/** Approve / request changes / comment / merge — the full review loop without
 * leaving the app. */
function PrActions({
  repo,
  number,
  mergeableState,
  draft,
}: {
  repo: string;
  number: number;
  mergeableState: string;
  draft: boolean;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);

  const act = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      await fn();
      setResult(label === "merge" ? "Merged ✓" : "Review submitted ✓");
      setComment("");
      setConfirmMerge(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const review = (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") =>
    act(event, () => githubPrReview(repo, number, event, comment));

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Review comment (optional for approve, required for request changes / comment)…"
        rows={2}
        className="w-full resize-y rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void review("APPROVE")} disabled={!!busy}>
          {busy === "APPROVE" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Approve
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void review("REQUEST_CHANGES")}
          disabled={!!busy || !comment.trim()}
        >
          Request changes
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void review("COMMENT")}
          disabled={!!busy || !comment.trim()}
        >
          Comment
        </Button>
        <div className="ml-auto">
          {confirmMerge ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-ink-3">Squash-merge?</span>
              <Button
                size="sm"
                onClick={() => void act("merge", () => githubPrMerge(repo, number, "squash"))}
                disabled={!!busy}
              >
                {busy === "merge" ? <Loader2 size={12} className="animate-spin" /> : null}
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmMerge(false)}>
                No
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmMerge(true)}
              disabled={!!busy || draft || mergeableState === "dirty"}
              title={
                draft
                  ? "Draft PR"
                  : mergeableState === "dirty"
                    ? "Has conflicts"
                    : `Mergeable: ${mergeableState}`
              }
            >
              Merge
            </Button>
          )}
        </div>
      </div>
      {result && <p className="mt-1.5 text-xs font-medium text-success">{result}</p>}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

function PrFileRow({ f }: { f: PrDetail["files"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-2 bg-surface px-2.5 py-1.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.filename}</span>
        {f.status === "added" && <span className="text-[10px] font-semibold text-success uppercase">new</span>}
        {f.status === "removed" && <span className="text-[10px] font-semibold text-danger uppercase">deleted</span>}
        <span className="shrink-0 text-xs">
          <span className="text-success">+{f.additions}</span>{" "}
          <span className="text-danger">−{f.deletions}</span>
        </span>
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-4.5 select-text">
          {f.patch ? (
            f.patch.split("\n").map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("+")
                    ? "bg-success/10 text-success"
                    : line.startsWith("-")
                      ? "bg-danger/10 text-danger"
                      : line.startsWith("@@")
                        ? "text-accent"
                        : "text-ink-2"
                }
              >
                {line || " "}
              </div>
            ))
          ) : (
            <span className="text-ink-3">No text diff (binary or too large).</span>
          )}
        </pre>
      )}
    </div>
  );
}

interface TicketComment {
  author: string;
  body: string;
  at: string;
}

/** Jump back to the terminal tab of a finished agent run, if it's still open. */
function OpenAgentTerminal({ n }: { n: AppNotification }) {
  const tabs = useTerminal((s) => s.tabs);
  const activate = useTerminal((s) => s.activate);
  const setOpen = useTerminal((s) => s.setOpen);
  const tab = tabs.find((t) => t.notificationId === n.meta?.orig_id);
  if (!tab) return null;
  return (
    <Button
      variant="secondary"
      onClick={() => {
        activate(tab.id);
        setOpen(true);
      }}
    >
      <TerminalSquare size={14} />
      Open agent terminal
    </Button>
  );
}

/** Inline Linear actions: change state, assign to me, add a comment. */
function LinearActions({ n }: { n: AppNotification }) {
  const issueId = n.id.replace(/^lin:/, "");
  const [teams, setTeams] = useState<LinearTeamMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  useEffect(() => {
    linearMeta().then(setTeams).catch(() => setTeams([]));
  }, []);

  // States from the ticket's team; fall back to all teams' states.
  const states = useMemo(() => {
    const team = teams?.find((t) => t.name === n.meta?.team || t.key === n.meta?.team);
    const nodes = team ? team.states.nodes : (teams ?? []).flatMap((t) => t.states.nodes);
    const seen = new Set<string>();
    return nodes
      .sort((a, b) => a.position - b.position)
      .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
  }, [teams, n.meta?.team]);

  const act = async (label: string, fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      void useSync.getState().sync(); // refresh the ticket's chips
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value=""
          onChange={(e) => {
            const s = states.find((st) => st.id === e.target.value);
            if (s) void act("state", () => linearUpdateIssue(issueId, s.id), `Moved to ${s.name} ✓`);
          }}
          disabled={!!busy || states.length === 0}
          className="h-7.5 rounded-lg border border-line bg-surface-2 px-2 text-xs outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="" disabled>
            {busy === "state" ? "Updating…" : `Move to… (now: ${n.meta?.state ?? "?"})`}
          </option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!busy}
          onClick={() =>
            void act("assign", () => linearUpdateIssue(issueId, undefined, "me"), "Assigned to you ✓")
          }
        >
          {busy === "assign" ? <Loader2 size={12} className="animate-spin" /> : <UserRoundPlus size={12} />}
          Assign to me
        </Button>
        {msg && <span className="text-xs font-medium text-success">{msg}</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
      <div className="mt-2 flex items-start gap-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment (markdown)…"
          rows={1}
          className="min-h-8 flex-1 resize-y rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!!busy || !comment.trim()}
          onClick={() =>
            void act(
              "comment",
              async () => {
                await linearAddComment(issueId, comment.trim());
                setComment("");
              },
              "Comment posted ✓",
            )
          }
        >
          {busy === "comment" ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </Button>
      </div>
    </div>
  );
}

/** Full ticket body + latest comments, collapsible (Linear). */
function LinearSections({ n }: { n: AppNotification }) {
  const description = n.meta?.description;
  let comments: TicketComment[] = [];
  try {
    comments = n.meta?.comments ? (JSON.parse(n.meta.comments) as TicketComment[]) : [];
  } catch {
    comments = [];
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <LinearActions n={n} />
      {description && (
        <Collapsible title="Ticket description" defaultOpen>
          <Markdown className="text-[13px] leading-5.5">{description}</Markdown>
        </Collapsible>
      )}
      {comments.length > 0 && (
        <Collapsible
          title="Comments"
          badge={<Chip>{comments.length}</Chip>}
          defaultOpen={comments.length <= 2}
        >
          <div className="flex flex-col gap-2.5">
            {comments.map((c, i) => (
              <div key={i} className="rounded-lg bg-surface-3/60 p-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold">{c.author}</span>
                  {c.at && (
                    <span className="text-[10.5px] text-ink-3">
                      {relativeTime(Date.parse(c.at) || Date.now())}
                    </span>
                  )}
                </div>
                <Markdown className="mt-1 text-[13px] leading-5">{c.body}</Markdown>
              </div>
            ))}
          </div>
        </Collapsible>
      )}
    </div>
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
