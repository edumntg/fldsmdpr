import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, Trash2, KeyRound, Plus, MessageSquare } from "lucide-react";
import { useAsk } from "../../stores/ask";
import { useUi } from "../../stores/ui";
import { useInbox } from "../../stores/inbox";
import { CardContextMenu, NotificationCard, type MenuState } from "../inbox/NotificationList";
import type { AppNotification } from "../../lib/types";
import { jevStatus } from "../../lib/ipc";
import { Markdown } from "../../components/ui/Markdown";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/utils";

const SUGGESTIONS = [
  "Summarize the last 3 hours",
  "What's most urgent right now?",
  "What did I miss today?",
  "What did the agents finish this week?",
];

type Segment = { text: string } | { ids: string[] };

/** Split an answer into markdown text and runs of `[[notification-id]]` card markers
 * (the model is told to reference items that way — see ask.rs). */
export function segments(content: string): Segment[] {
  const out: Segment[] = [];
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    const ids = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim());
    const text = line.replace(/\[\[[^\]]+\]\]/g, "").replace(/^\s*(?:[-*]|\d+\.)\s*$/, "");
    const last = out[out.length - 1];
    // Blank lines right after cards are skipped so a card run isn't split.
    if (text.trim() || (!ids.length && !(last && "ids" in last))) {
      if (last && "text" in last) last.text += "\n" + text;
      else out.push({ text });
    }
    const fresh = ids.filter((id) => !seen.has(id) && seen.add(id));
    if (!fresh.length) continue;
    const tail = out[out.length - 1];
    if (tail && "ids" in tail) tail.ids.push(...fresh);
    else out.push({ ids: fresh });
  }
  return out;
}

/** Chat with Gemini (via OpenRouter) over everything the app knows: notifications, tickets,
 * agent runs, sync state. Answers come from the local DB — no live fetching. */
export function AskView() {
  const { chats, activeId, runningId, error, send, newChat, select, remove, prefill, setPrefill } = useAsk();
  const messages = chats.find((c) => c.id === activeId)?.messages ?? [];
  const running = runningId !== null && runningId === activeId;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const setSection = useUi((s) => s.setSection);
  // Ask runs on the OpenRouter key shared with Jev; null = still checking.
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    jevStatus().then(
      (s) => setHasKey(s.connected),
      () => setHasKey(false),
    );
  }, []);

  // "Ask about this" lands here with a question pre-typed, ready to edit or send.
  useEffect(() => {
    if (prefill) {
      setDraft(prefill);
      setPrefill(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [prefill, setPrefill]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, running, activeId]);

  const submit = () => {
    if (!draft.trim() || runningId || !hasKey) return;
    void send(draft);
    setDraft("");
  };

  return (
    <div className="flex h-full min-w-0 flex-1">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line">
        <header data-tauri-drag-region className="flex h-13 shrink-0 items-center px-3">
          <span className="text-xs font-medium text-ink-3">Chats</span>
          <div className="ml-auto">
            <IconButton label="New chat" onClick={newChat}>
              <Plus size={15} />
            </IconButton>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 && <p className="px-2 text-xs text-ink-3">No chats yet.</p>}
          {[...chats]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((c) => (
              <div
                key={c.id}
                onClick={() => select(c.id)}
                className={cn(
                  "group flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]",
                  c.id === activeId ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-3",
                )}
              >
                {runningId === c.id ? (
                  <Loader2 size={13} className="shrink-0 animate-spin" />
                ) : (
                  <MessageSquare size={13} className="shrink-0 opacity-60" />
                )}
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <button
                  aria-label="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(c.id);
                  }}
                  className="shrink-0 cursor-default rounded p-0.5 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-danger"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
        </div>
      </aside>
      <section className="flex h-full min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className="flex h-13 shrink-0 items-center gap-2 px-5">
          <h1 className="text-[15px] font-semibold tracking-tight">Ask</h1>
          <span className="text-xs text-ink-3">— answers from your inbox, tickets & agents</span>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 pt-1">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 pb-4">
            {hasKey === false && (
              <div className="mt-16 flex flex-col items-center gap-4">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-surface-3 text-ink-3">
                  <KeyRound size={20} />
                </span>
                <p className="text-[14px] font-medium">OpenRouter API key needed</p>
                <p className="max-w-sm text-center text-[13px] text-ink-3">
                  Ask runs on Gemini through OpenRouter. Add your OpenRouter API key in Settings →
                  Intelligence to start asking.
                </p>
                <button
                  onClick={() => setSection("settings")}
                  className="cursor-default rounded-pill bg-accent px-3.5 py-1.5 text-xs text-accent-fg hover:bg-accent-hover"
                >
                  Open Settings
                </button>
              </div>
            )}

            {hasKey && messages.length === 0 && (
              <div className="mt-16 flex flex-col items-center gap-4">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-src-agent/12 text-src-agent">
                  <Sparkles size={20} />
                </span>
                <p className="text-[14px] font-medium">Ask anything about your work</p>
                <p className="max-w-sm text-center text-[13px] text-ink-3">
                  Answers come from what's already in the app — notifications, PRs, tickets, errors, meetings
                  and agent runs.
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => !runningId && void send(s)}
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
                    <Answer content={m.content} />
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
              disabled={!hasKey}
              className="max-h-40 flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-5.5 outline-none placeholder:text-ink-3 focus:border-accent"
            />
            <button
              onClick={submit}
              disabled={!!runningId || !draft.trim() || !hasKey}
              className={cn(
                "flex size-10 shrink-0 cursor-default items-center justify-center rounded-xl transition-colors",
                runningId || !draft.trim()
                  ? "bg-surface-3 text-ink-3"
                  : "bg-accent text-accent-fg hover:bg-accent-hover",
              )}
              aria-label="Send"
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Assistant answer: markdown, with `[[id]]` references rendered as the same cards the inbox uses. */
function Answer({ content }: { content: string }) {
  const items = useInbox((s) => s.items);
  const setSection = useUi((s) => s.setSection);
  const selectItem = useUi((s) => s.select);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const byId = new Map(items.map((n) => [n.id, n]));
  const open = (n: AppNotification) => {
    setSection("inbox");
    selectItem(n.id);
  };
  return (
    <>
      {segments(content).map((seg, i) =>
        "text" in seg ? (
          seg.text.trim() && (
            <Markdown key={i} className="text-[13.5px]">
              {seg.text}
            </Markdown>
          )
        ) : (
          <ul key={i} className="my-2 flex flex-col gap-1.5">
            {seg.ids.map((id, j) => {
              const n = byId.get(id);
              return n ? (
                <NotificationCard
                  key={id}
                  n={n}
                  index={j}
                  selected={false}
                  onSelect={() => open(n)}
                  onOpenMenu={(e) => {
                    e.preventDefault();
                    setMenu({ n, x: e.clientX, y: e.clientY });
                  }}
                />
              ) : null;
            })}
          </ul>
        ),
      )}
      {menu && <CardContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}
