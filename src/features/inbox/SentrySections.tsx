import { useEffect, useState } from "react";
import { sentryIssueDetail, type SentryIssueDetail } from "../../lib/ipc";
import type { AppNotification } from "../../lib/types";
import { Collapsible } from "../../components/ui/Collapsible";
import { Chip } from "../../components/ui/Chip";
import { setPromptContext } from "../agents/prompt";
import { relativeTime, cn } from "../../lib/utils";

/** Turns the detail into plain text for the fix-agent prompt: exception,
 * stack trace with source context, tags. */
function toPromptContext(d: SentryIssueDetail): string {
  const frames = d.frames
    .map(
      (f) =>
        `  at ${f.function} (${f.file}:${f.line})${f.in_app ? " [in-app]" : ""}` +
        (f.in_app && f.code ? `\n${f.code}` : ""),
    )
    .join("\n");
  return [
    `Sentry issue detail — project ${d.project}, level ${d.level}, ${d.count} events, ${d.user_count} users affected.`,
    d.exception_type ? `Exception: ${d.exception_type}: ${d.exception_value}` : null,
    d.message ? `Message: ${d.message}` : null,
    d.culprit ? `Culprit: ${d.culprit}` : null,
    frames ? `Stack trace (newest first):\n${frames}` : null,
    d.tags.length ? `Tags: ${d.tags.map(([k, v]) => `${k}=${v}`).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

/** Everything an agent (or you) needs to fix the error without opening
 * sentry.io: exception, stack trace with code context, tags, impact. */
export function SentrySections({ n }: { n: AppNotification }) {
  const [detail, setDetail] = useState<SentryIssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const issueId = n.id.replace(/^sentry:/, "");

  useEffect(() => {
    setDetail(null);
    setError(null);
    let cancelled = false;
    sentryIssueDetail(issueId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setPromptContext(n.id, toPromptContext(d)); // feeds "Fix with agent"
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [issueId, n.id]);

  if (error) return <p className="mt-3 text-xs text-ink-3">Couldn't load issue details: {error}</p>;
  if (!detail) return <p className="mt-3 text-xs text-ink-3">Loading issue details…</p>;

  const inApp = detail.frames.filter((f) => f.in_app);
  const shownFrames = inApp.length > 0 ? inApp : detail.frames.slice(0, 10);

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        <span>
          <span className="font-medium text-ink-2">{detail.count}</span> events
        </span>
        <span>
          <span className="font-medium text-ink-2">{detail.user_count}</span> users
        </span>
        {detail.first_seen && <span>first seen {relativeTime(Date.parse(detail.first_seen))}</span>}
        {detail.last_seen && <span>last seen {relativeTime(Date.parse(detail.last_seen))}</span>}
        <span className="uppercase">{detail.status}</span>
      </div>

      {(detail.exception_type || detail.message) && (
        <div className="rounded-xl border border-danger/25 bg-danger/6 p-3">
          <p className="font-mono text-[12.5px] font-semibold text-danger select-text">
            {detail.exception_type || "Message"}
          </p>
          <p className="mt-0.5 font-mono text-[12px] leading-5 text-ink-2 select-text">
            {detail.exception_value || detail.message}
          </p>
          {detail.culprit && <p className="mt-1 font-mono text-[11px] text-ink-3">{detail.culprit}</p>}
        </div>
      )}

      {shownFrames.length > 0 && (
        <Collapsible title={`Stack trace (${shownFrames.length} frames)`} defaultOpen>
          <div className="flex flex-col gap-1">
            {shownFrames.map((f, i) => (
              <FrameRow key={i} f={f} defaultOpen={i === 0} />
            ))}
          </div>
        </Collapsible>
      )}

      {detail.tags.length > 0 && (
        <Collapsible title="Tags" badge={<Chip>{detail.tags.length}</Chip>}>
          <div className="flex flex-wrap gap-1.5">
            {detail.tags.map(([k, v]) => (
              <span
                key={k}
                className="rounded-lg bg-surface-3 px-2 py-0.5 font-mono text-[11px] text-ink-2 select-text"
              >
                {k}={v}
              </span>
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

function FrameRow({ f, defaultOpen }: { f: SentryIssueDetail["frames"][number]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen && !!f.code);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <button
        onClick={() => f.code && setOpen((o) => !o)}
        className={cn(
          "flex w-full cursor-default items-baseline gap-2 px-2.5 py-1.5 text-left",
          f.in_app ? "bg-surface" : "bg-surface opacity-60",
        )}
      >
        <span className="truncate font-mono text-xs font-medium">{f.function}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">
          {f.file}:{f.line}
        </span>
        {f.in_app && <span className="shrink-0 text-[10px] font-semibold text-src-agent">in-app</span>}
      </button>
      {open && f.code && (
        <pre className="overflow-x-auto bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-4.5 text-ink-2 select-text">
          {f.code}
        </pre>
      )}
    </div>
  );
}
