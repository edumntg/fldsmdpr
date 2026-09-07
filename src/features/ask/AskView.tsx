import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, Trash2 } from "lucide-react";
import { useAsk } from "../../stores/ask";
import { Markdown } from "../../components/ui/Markdown";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/utils";

const SUGGESTIONS = [
  "Summarize the last 3 hours",
  "What's most urgent right now?",
  "What did I miss today?",
  "What did the agents finish this week?",
];

/** Chat with claude over everything the app knows: notifications, tickets,
 * agent runs, sync state. Answers come from the local DB — no live fetching. */
export function AskView() {
  const { messages, running, error, send, clear } = useAsk();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, running]);

  const submit = () => {
    if (!draft.trim() || running) return;
    void send(draft);
    setDraft("");
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center gap-2 px-5">
        <h1 className="text-[15px] font-semibold tracking-tight">Ask</h1>
        <span className="text-xs text-ink-3">— answers from your inbox, tickets & agents</span>
        {messages.length > 0 && (
          <div className="ml-auto">
            <IconButton label="Clear conversation" onClick={clear}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 pt-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 pb-4">
          {messages.length === 0 && (
            <div className="mt-16 flex flex-col items-center gap-4">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-src-agent/12 text-src-agent">
                <Sparkles size={20} />
              </span>
              <p className="text-[14px] font-medium">Ask anything about your work</p>
              <p className="max-w-sm text-center text-[13px] text-ink-3">
                Claude answers from what's already in the app — notifications, PRs, tickets, errors,
                meetings and agent runs.
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="cursor-default rounded-pill border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] leading-5.5 text-accent-fg select-text">
                  {m.content}
                </div>
              ) : (
                <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-surface-2 px-4 py-2.5 shadow-card">
                  <Markdown className="text-[13.5px]">{m.content}</Markdown>
                </div>
              )}
            </div>
          ))}

          {running && (
            <div className="flex items-center gap-2 text-[13px] text-src-agent">
              <Loader2 size={14} className="animate-spin" />
              Reading your data…
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </div>

      <div className="shrink-0 border-t border-line p-4">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="e.g. “Summarize the last 3 hours”  ·  Enter to send"
            rows={2}
            className="max-h-40 flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-5.5 outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <button
            onClick={submit}
            disabled={running || !draft.trim()}
            className={cn(
              "flex size-10 shrink-0 cursor-default items-center justify-center rounded-xl transition-colors",
              running || !draft.trim() ? "bg-surface-3 text-ink-3" : "bg-accent text-accent-fg hover:bg-accent-hover",
            )}
            aria-label="Send"
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </section>
  );
}
