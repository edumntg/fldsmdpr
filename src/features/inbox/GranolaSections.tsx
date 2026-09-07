import { useEffect, useState } from "react";
import { Loader2, FileText, ListChecks } from "lucide-react";
import { granolaTranscript } from "../../lib/ipc";
import type { AppNotification } from "../../lib/types";
import { Collapsible } from "../../components/ui/Collapsible";
import { Chip } from "../../components/ui/Chip";
import { Button } from "../../components/ui/Button";
import { Markdown } from "../../components/ui/Markdown";
import { cn } from "../../lib/utils";

/** Meeting context for a Granola action item: every action item from the same
 * meeting (current one highlighted) plus the transcript, loaded on demand. */
export function GranolaSections({ n }: { n: AppNotification }) {
  const meeting = n.meta?.meeting;
  let siblings: string[] = [];
  try {
    siblings = n.meta?.meeting_items ? (JSON.parse(n.meta.meeting_items) as string[]) : [];
  } catch {
    siblings = [];
  }

  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transcript state when switching to a different meeting's item.
  useEffect(() => {
    setTranscript(null);
    setLoading(false);
    setError(null);
  }, [meeting]);

  if (!meeting) return null;

  const loadTranscript = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      setTranscript(await granolaTranscript(meeting));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      {siblings.length > 0 && (
        <Collapsible
          title="Action items from this meeting"
          badge={<Chip>{siblings.length}</Chip>}
          defaultOpen={siblings.length > 1}
        >
          <div className="flex flex-col gap-1">
            {siblings.map((item, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[13px] leading-5",
                  item === n.title ? "bg-accent-soft font-medium text-accent" : "bg-surface text-ink-2",
                )}
              >
                <ListChecks size={13} className="mt-0.5 shrink-0" />
                <span className="select-text">{item}</span>
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      <Collapsible title="Transcript" defaultOpen={false}>
        {transcript ? (
          <Markdown className="max-h-96 overflow-y-auto text-[13px] leading-5.5">{transcript}</Markdown>
        ) : (
          <div className="flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => void loadTranscript()} disabled={loading}>
              {loading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              {loading ? "Fetching via Claude…" : "Load transcript"}
            </Button>
            <span className="text-xs text-ink-3">
              {loading ? "takes ~1 min the first time" : "cached after the first load"}
            </span>
          </div>
        )}
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      </Collapsible>
    </div>
  );
}
