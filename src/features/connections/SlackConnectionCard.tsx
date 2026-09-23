import { useEffect, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Loader2,
  Unplug,
  CheckCircle2,
  Hash,
  RefreshCw,
  Plus,
  X,
  Eye,
  ShieldCheck,
  LogIn,
} from "lucide-react";
import { providerMeta } from "./providerMeta";
import { useConnections } from "../../stores/connections";
import {
  slackConnect,
  slackSignIn,
  slackListChannels,
  slackResolveChannel,
  slackGetChannels,
  slackSetChannels,
  type SlackChannel,
} from "../../lib/ipc";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { SourceBadge } from "../../components/ui/SourceBadge";
import { ClaudeSlackSection } from "./ClaudeSlackSection";
import { useSlackAi } from "../../stores/slackAi";
import { cn, openExternal } from "../../lib/utils";

const meta = providerMeta("slack")!;

/**
 * Slack connection. Fast path first: session-token auth (xoxc + xoxd) reads
 * the Web API directly in milliseconds — the org blocks Slack apps, and this
 * needs none. Mentions/DMs are explicit; Jev (when connected) judges the rest
 * and flags your own unanswered asks. Claude summaries are a slow, optional
 * second section.
 */
export function SlackConnectionCard({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const { statuses, refresh, disconnect } = useConnections();
  const slackEnabled = useSlackAi((s) => s.enabled);
  const setSlackEnabled = useSlackAi((s) => s.setEnabled);
  const status = statuses.find((s) => s.id === "slack");
  const connected = status?.connected ?? false;

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [xoxc, setXoxc] = useState("");
  const [xoxd, setXoxd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(!connected);
  /** "consent" = gate shown, "signing" = Slack window open and being polled. */
  const [phase, setPhase] = useState<"idle" | "consent" | "signing">("idle");
  const [manual, setManual] = useState(false);

  const onSignIn = async () => {
    setPhase("signing");
    setError(null);
    try {
      await slackSignIn();
      await refresh();
      if (!slackEnabled) await setSlackEnabled(true); // connecting implies "on"
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  };

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await slackConnect(xoxc, xoxd);
      setXoxc("");
      setXoxd("");
      await refresh();
      if (!slackEnabled) await setSlackEnabled(true); // connecting implies "on"
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface-2 shadow-card">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full cursor-default items-center gap-3 p-4 text-left"
      >
        <SourceBadge source="slack" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold">Slack</span>
            {connected ? (
              <Chip tone="success">
                <CheckCircle2 size={11} />
                {status?.account ?? "Connected"}
              </Chip>
            ) : (
              <Chip>Not connected</Chip>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">{meta.tokenLabel}</p>
        </div>
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-ink-3 transition-transform duration-200", expanded && "rotate-180")}
        />
      </button>

      {expanded && (
        <div className="animate-fade-in border-t border-line px-4 pt-3.5 pb-4">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-semibold">Fast path: your browser session</h4>
            <span className="rounded-pill bg-src-agent/12 px-1.5 py-0.5 text-[10px] font-medium text-src-agent">
              Recommended · seconds
            </span>
            {connected && (
              <button
                onClick={() => setShowToken((s) => !s)}
                className="ml-auto inline-flex cursor-default items-center gap-1.5 text-xs font-medium text-ink-3 hover:text-ink"
              >
                <ChevronDown size={12} className={cn("transition-transform", showToken && "rotate-180")} />
                {showToken ? "Hide" : "Channels & token"}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[13px] leading-5 text-ink-2">
            Reads your DMs and the channels you pick straight from Slack's Web API on every sync — no
            Slack app, no admin approval. @-mentions and DMs always land in the inbox; with AI triage
            connected, Jev also flags messages relevant to you and your own asks still waiting for a reply.
          </p>

          {(showToken || !connected) && (
            <div className="mt-3">
          {!connected ? (
            <>
              <h4 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Setup guide</h4>
              <ol className="mt-3 flex flex-col">
                {meta.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10.5px] font-bold text-accent ring-1 ring-accent/20">
                        {i + 1}
                      </span>
                      {i < meta.steps.length - 1 && (
                        <span className="w-px flex-1 bg-gradient-to-b from-accent/25 to-line-strong" />
                      )}
                    </div>
                    <p
                      className={cn(
                        "min-w-0 flex-1 text-[13px] leading-5 text-ink-2",
                        i < meta.steps.length - 1 && "pb-3.5",
                      )}
                    >
                      {s}
                    </p>
                  </li>
                ))}
              </ol>

              {phase === "consent" ? (
                <div className="mt-4 rounded-xl border border-accent/25 bg-accent-soft/40 p-3.5">
                  <h5 className="text-[13px] font-semibold">Before you sign in</h5>
                  <p className="mt-1 text-[12.5px] leading-5 text-ink-2">
                    Signing in gives FLDSMDPR the same read access to Slack that you already have.
                    Here is exactly what that means, so you can decide.
                  </p>

                  <p className="mt-3 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                    What FLDSMDPR will do
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {meta.consent?.will.map((c) => (
                      <li key={c} className="flex gap-2 text-[12.5px] leading-5 text-ink-2">
                        <Eye size={13} className="mt-1 shrink-0 text-accent" />
                        <span className="min-w-0 flex-1">{c}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-3 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                    What it will never do
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {meta.consent?.wont.map((c) => (
                      <li key={c} className="flex gap-2 text-[12.5px] leading-5 text-ink-2">
                        <ShieldCheck size={13} className="mt-1 shrink-0 text-success" />
                        <span className="min-w-0 flex-1">{c}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-3 text-[12px] leading-5 text-ink-3">{meta.consent?.undo}</p>
                  <button
                    onClick={() => void openExternal(meta.createUrl)}
                    className="mt-1.5 inline-flex cursor-default items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
                  >
                    <ExternalLink size={12} />
                    {meta.createUrlLabel}
                  </button>

                  <div className="mt-3.5 flex items-center gap-2">
                    <Button variant="primary" onClick={() => void onSignIn()}>
                      <LogIn size={14} />
                      I understand — open Slack sign-in
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPhase("idle")}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : phase === "signing" ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3.5">
                  <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-accent" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">Waiting for you to finish signing in…</p>
                    <p className="mt-0.5 text-[12.5px] leading-5 text-ink-3">
                      Log in in the Slack window that just opened. It closes on its own once you are
                      through. Close it yourself to cancel.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-col items-start gap-2.5">
                  <Button variant="primary" onClick={() => setPhase("consent")}>
                    <LogIn size={14} />
                    Sign in to Slack
                  </Button>
                  <button
                    onClick={() => setManual((m) => !m)}
                    className="cursor-default text-[12px] font-medium text-ink-3 hover:text-ink"
                  >
                    {manual ? "Hide manual token entry" : "Paste tokens manually instead"}
                  </button>
                  {manual && (
                    <div className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface p-3">
                      <p className="text-[12px] leading-5 text-ink-3">
                        Fallback for if the sign-in window fails. In Slack’s DevTools console, type{" "}
                        <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11px] select-text">
                          allow pasting
                        </code>{" "}
                        and press Enter first — Chrome blocks pasting into the console until you do.
                      </p>
                      <code className="block rounded-lg bg-surface-3 p-2 font-mono text-[11px] break-all select-text">
                        Object.values(JSON.parse(localStorage.localConfig_v2).teams)[0].token
                      </code>
                      <input
                        type="password"
                        value={xoxc}
                        onChange={(e) => setXoxc(e.target.value)}
                        placeholder="xoxc-… (token)"
                        className="h-8.5 rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
                      />
                      <input
                        type="password"
                        value={xoxd}
                        onChange={(e) => setXoxd(e.target.value)}
                        placeholder="xoxd-… (d cookie)"
                        className="h-8.5 rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
                      />
                      <Button
                        variant="primary"
                        disabled={!xoxc || busy}
                        onClick={() => void onConnect()}
                        className="self-start"
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                        Connect
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <ChannelPicker />
          )}

          {error && <p className="mt-2.5 text-xs text-danger">{error}</p>}

          <div className={cn("flex items-center", connected ? "mt-4" : "mt-3")}>
            {connected && (
              <div className="flex items-center gap-2">
                <Button variant="danger" size="sm" onClick={() => void disconnect("slack")}>
                  <Unplug size={13} />
                  Disconnect
                </Button>
                {/* "Connected" only means a session is stored, not that it still
                    works — so rotation needs a re-auth that isn't Disconnect first. */}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={phase === "signing"}
                  onClick={() => void onSignIn()}
                >
                  {phase === "signing" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <LogIn size={13} />
                  )}
                  {phase === "signing" ? "Signing in…" : "Sign in again"}
                </Button>
              </div>
            )}
            <p className="ml-auto max-w-80 text-right text-[11px] text-ink-3">
              Your session is read-only and stored only in your OS keychain. Slack rotates it
              periodically — press Sign in to Slack again if sync starts failing. DMs are included
              automatically.
            </p>
          </div>
            </div>
          )}

          <div className="mt-4 border-t border-line pt-3.5">
            <ClaudeSlackSection />
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelPicker() {
  const [all, setAll] = useState<SlackChannel[] | null>(null);
  const [opted, setOpted] = useState<SlackChannel[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setListErr(null);
    setOpted(await slackGetChannels());
    try {
      setAll(await slackListChannels());
    } catch (e) {
      // enterprise_is_restricted etc. — fall back to manual entry.
      setAll(null);
      setListErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const persist = async (next: SlackChannel[]) => {
    setOpted(next);
    await slackSetChannels(next);
  };

  const isOpted = (id: string) => opted.some((c) => c.id === id);

  const toggle = (c: SlackChannel) =>
    persist(isOpted(c.id) ? opted.filter((x) => x.id !== c.id) : [...opted, c]);

  const remove = (id: string) => persist(opted.filter((c) => c.id !== id));

  const addManual = async () => {
    if (!manual.trim()) return;
    setBusy(true);
    setAddErr(null);
    try {
      const ch = await slackResolveChannel(manual.trim());
      if (!isOpted(ch.id)) await persist([...opted, ch]);
      setManual("");
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Channels to watch</h4>
        <button
          onClick={() => void load()}
          className="inline-flex cursor-default items-center gap-1 text-[11px] text-ink-3 hover:text-ink"
        >
          <RefreshCw size={11} className={cn(loading && "animate-spin")} />
          Reload
        </button>
      </div>

      {loading && !all && !listErr && <p className="py-3 text-xs text-ink-3">Loading channels…</p>}

      {/* Full channel list when the org allows it. */}
      {all && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
          {all.map((c) => (
            <label
              key={c.id}
              className="flex cursor-default items-center gap-2.5 border-b border-line px-3 py-2 last:border-0 hover:bg-surface-3"
            >
              <input
                type="checkbox"
                checked={isOpted(c.id)}
                onChange={() => void toggle(c)}
                className="size-3.5 accent-accent"
              />
              <Hash size={12} className="text-ink-3" />
              <span className="text-[13px]">{c.name.replace(/^#/, "")}</span>
            </label>
          ))}
        </div>
      )}

      {/* Manual entry when listing is enterprise-restricted. */}
      {listErr && (
        <div className="rounded-xl bg-warning/8 p-3">
          <p className="text-xs text-ink-2">
            Your org restricts channel listing, so add channels by hand: in Slack open a channel →
            its name → <span className="font-medium">Copy link</span>, and paste it here.
          </p>
          <div className="mt-2.5 flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void addManual()}
              placeholder="Paste channel link or ID (C0…)"
              className="h-8 flex-1 rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            />
            <Button size="sm" variant="primary" disabled={!manual.trim() || busy} onClick={() => void addManual()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Add
            </Button>
          </div>
          {addErr && <p className="mt-1.5 text-xs text-danger">{addErr}</p>}
        </div>
      )}

      {/* Currently-watched channels (works in both modes). */}
      {opted.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {opted.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-pill bg-surface-3 px-2 py-1 text-[11.5px] text-ink-2"
            >
              <Hash size={10} className="text-ink-3" />
              {c.name.replace(/^#/, "")}
              <button
                onClick={() => void remove(c.id)}
                className="cursor-default text-ink-3 hover:text-danger"
                aria-label={`Stop watching ${c.name}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink-3">
        {opted.length} channel{opted.length === 1 ? "" : "s"} watched · saved automatically
      </p>
    </div>
  );
}
