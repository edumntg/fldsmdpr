import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CircleDot, Loader2, Check, X, Bot, ExternalLink } from "lucide-react";
import {
  linearMeta,
  linearCreateIssue,
  notificationSetMeta,
  type LinearTeamMeta,
} from "../../lib/ipc";
import { useInbox } from "../../stores/inbox";
import type { AppNotification } from "../../lib/types";
import { Button } from "../../components/ui/Button";
import { useAgents } from "../../stores/agents";
import { getPromptContext } from "../agents/prompt";
import { cn } from "../../lib/utils";

const PRIORITIES = [
  { value: 0, label: "No priority" },
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
];

function defaultDescription(n: AppNotification): string {
  const rich = getPromptContext(n.id);
  return [
    n.snippet,
    rich ? `\n\`\`\`\n${rich}\n\`\`\`` : null,
    n.url ? `\nSource: ${n.url}` : null,
    `\n_Created from FLDSMDPR (${n.source})_`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Button + modal: turn a Sentry incident or Slack task into a Linear ticket
 * (team/project/assignee/status/date/priority), optionally launching a fix
 * agent that carries both the original context and the new ticket. */
export function CreateTicketButton({ n }: { n: AppNotification }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <CircleDot size={14} />
        Create Linear ticket
      </Button>
      {open && <CreateTicketModal n={n} onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateTicketModal({ n, onClose }: { n: AppNotification; onClose: () => void }) {
  const [teams, setTeams] = useState<LinearTeamMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [teamId, setTeamId] = useState("");
  const [title, setTitle] = useState(n.title.replace(/^\[\w+\]\s*/, ""));
  const [description, setDescription] = useState(() => defaultDescription(n));
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [stateId, setStateId] = useState("");
  const [priority, setPriority] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [launchAgent, setLaunchAgent] = useState(false);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ identifier: string; url: string } | null>(null);
  const launch = useAgents((s) => s.launch);

  useEffect(() => {
    linearMeta()
      .then((t) => {
        setTeams(t);
        if (t.length > 0) setTeamId(t[0].id);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const team = useMemo(() => teams?.find((t) => t.id === teamId), [teams, teamId]);
  const states = useMemo(
    () => [...(team?.states.nodes ?? [])].sort((a, b) => a.position - b.position),
    [team],
  );

  // Reset team-scoped picks when the team changes.
  useEffect(() => {
    setProjectId("");
    setAssigneeId("");
    setStateId("");
  }, [teamId]);

  const create = async () => {
    if (!teamId || !title.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const issue = await linearCreateIssue({
        team_id: teamId,
        title: title.trim(),
        description,
        project_id: projectId || undefined,
        assignee_id: assigneeId || undefined,
        state_id: stateId || undefined,
        priority: priority || undefined,
        due_date: dueDate || undefined,
      });
      setCreated(issue);
      // Link the new ticket back to its source so both directions stay visible.
      void notificationSetMeta(n.id, "linked_ticket", issue.identifier)
        .then(() => notificationSetMeta(n.id, "linked_ticket_url", issue.url))
        .then(() => useInbox.getState().reload());
      if (launchAgent) {
        void launch(n, "Fix with agent", "claude", {
          extra: `A Linear ticket was created for this work: ${issue.identifier} — ${issue.url}. Reference it in your branch/commit/PR.`,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onMouseDown={onClose}
    >
      <div
        className="animate-pop-in flex max-h-full w-[520px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface-2 shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <CircleDot size={15} className="text-src-linear" />
          <h3 className="flex-1 text-[13.5px] font-semibold">New Linear ticket</h3>
          <button onClick={onClose} className="cursor-default rounded p-0.5 text-ink-3 hover:text-ink">
            <X size={15} />
          </button>
        </div>

        {created ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10">
            <Check size={28} className="text-success" />
            <p className="text-[14px] font-semibold">{created.identifier} created</p>
            {launchAgent && (
              <p className="flex items-center gap-1.5 text-xs text-ink-2">
                <Bot size={13} className="text-src-agent" />
                Fix agent launched in the terminal with the ticket context.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => void openExternal(created.url)}>
                <ExternalLink size={13} />
                Open in Linear
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5">
              {loadError && (
                <p className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{loadError}</p>
              )}

              <Field label="Title">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-8.5 w-full rounded-xl border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Team">
                  <Select value={teamId} onChange={setTeamId} disabled={!teams}>
                    {!teams && <option>Loading…</option>}
                    {teams?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={stateId} onChange={setStateId} disabled={!team}>
                    <option value="">Default</option>
                    {states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Project">
                  <Select value={projectId} onChange={setProjectId} disabled={!team}>
                    <option value="">None</option>
                    {team?.projects.nodes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Assignee / lead">
                  <Select value={assigneeId} onChange={setAssigneeId} disabled={!team}>
                    <option value="">Unassigned</option>
                    {team?.members.nodes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName || m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={String(priority)} onChange={(v) => setPriority(Number(v))}>
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due date">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-8.5 w-full rounded-xl border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent"
                  />
                </Field>
              </div>

              <Field label="Description (markdown)">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="w-full resize-y rounded-xl border border-line bg-surface px-2.5 py-2 font-mono text-[12px] leading-5 outline-none focus:border-accent"
                />
              </Field>

              <label className="flex cursor-default items-center gap-2 text-[13px] font-medium">
                <input
                  type="checkbox"
                  checked={launchAgent}
                  onChange={(e) => setLaunchAgent(e.target.checked)}
                  className="size-3.5 accent-accent"
                />
                <Bot size={14} className="text-src-agent" />
                Launch agent to fix this (creates the ticket, then starts Claude with its context)
              </label>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
              {error && <p className="min-w-0 flex-1 truncate text-xs text-danger">{error}</p>}
              <div className={cn("flex gap-2", !error && "ml-auto")}>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={() => void create()} disabled={creating || !teamId || !title.trim()}>
                  {creating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {launchAgent ? "Create + launch agent" : "Create ticket"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

async function openExternal(url: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="h-8.5 w-full rounded-xl border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent disabled:opacity-50"
    >
      {children}
    </select>
  );
}
