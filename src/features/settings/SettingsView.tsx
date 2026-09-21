import { useEffect, useState } from "react";
import {
  Moon,
  Sun,
  MonitorSmartphone,
  Database,
  KeyRound,
  RefreshCw,
  GraduationCap,
  Keyboard,
  Check,
  ZoomIn,
  ZoomOut,
  Rows3,
  Rows4,
} from "lucide-react";
import { useTheme, ACCENTS, type ThemePref, type Density } from "../../stores/theme";
import { useSync } from "../../stores/sync";
import { useUi, P0_WINDOW_LABELS, type P0Window } from "../../stores/ui";
import { useOnboarding } from "../onboarding/Onboarding";
import { appInfo, kvGet, kvSet, type AppInfo } from "../../lib/ipc";
import { PROVIDER_META } from "../connections/providerMeta";
import { ConnectionCard } from "../connections/ConnectionCard";
import { CalendarCard } from "../connections/CalendarCard";
import { AiSourceCard } from "../connections/AiSourceCard";
import { JevCard } from "../connections/JevCard";
import { SlackCard } from "../connections/SlackCard";
import { JevPlayground } from "./JevPlayground";
import { Button } from "../../components/ui/Button";
import { cn, relativeTime } from "../../lib/utils";

export function SettingsView() {
  const { pref, setPref, accent, setAccent, density, setDensity, zoom, zoomIn, zoomOut, zoomReset } = useTheme();
  const { refreshTime, setRefreshTime, lastSyncAt, sync, syncing } = useSync();
  const startOnboarding = useOnboarding((s) => s.start);
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  const { p0Count, setP0Count, p0Window, setP0Window } = useUi();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [aboutMe, setAboutMe] = useState<string | null>(null);

  useEffect(() => {
    void appInfo().then(setInfo);
    void kvGet("about_me").then((v) => setAboutMe(v ?? ""));
  }, []);

  const densities: { id: Density; label: string; icon: typeof Rows3 }[] = [
    { id: "comfortable", label: "Comfortable", icon: Rows3 },
    { id: "compact", label: "Compact", icon: Rows4 },
  ];

  const themes: { id: ThemePref; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: MonitorSmartphone },
  ];

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header data-tauri-drag-region className="flex h-13 shrink-0 items-center px-5">
        <h1 className="text-[15px] font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5 pt-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-6">
          <Card title="Appearance">
            <div className="flex gap-2">
              {themes.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setPref(id)}
                  className={cn(
                    "press flex h-9 flex-1 cursor-default items-center justify-center gap-2 rounded-xl border text-[13px] font-medium",
                    pref === id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-surface-2 text-ink-2 hover:border-line-strong",
                  )}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>

            <Row label="Accent" hint="Buttons, selection, badges.">
              <div className="flex gap-1.5">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAccent(a.id)}
                    title={a.label}
                    aria-label={a.label}
                    style={{ backgroundColor: a.swatch }}
                    className={cn(
                      "press flex size-6 cursor-default items-center justify-center rounded-full text-white ring-offset-2 ring-offset-surface-2 transition-shadow",
                      accent === a.id ? "ring-2 ring-[color:var(--accent)]" : "hover:ring-2 hover:ring-line-strong",
                    )}
                  >
                    {accent === a.id && <Check size={12} strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </Row>

            <Row label="Density" hint="How much fits on screen.">
              <div className="flex gap-1.5">
                {densities.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setDensity(id)}
                    className={cn(
                      "press flex h-8 cursor-default items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium",
                      density === id
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line bg-surface-2 text-ink-2 hover:border-line-strong",
                    )}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </Row>

            <Row label="Zoom" hint="⌘+ / ⌘− anywhere, ⌘0 to reset.">
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={zoomOut} aria-label="Zoom out">
                  <ZoomOut size={14} />
                </Button>
                <button onClick={zoomReset} className="w-12 cursor-default text-center text-xs font-medium tabular-nums text-ink-2 hover:text-ink">
                  {Math.round(zoom * 100)}%
                </button>
                <Button size="sm" variant="ghost" onClick={zoomIn} aria-label="Zoom in">
                  <ZoomIn size={14} />
                </Button>
              </div>
            </Row>

            <Row label="Keyboard shortcuts" hint="Press ? anywhere.">
              <Button size="sm" variant="secondary" onClick={() => setHelpOpen(true)}>
                <Keyboard size={13} />
                Show all
              </Button>
            </Row>
          </Card>

          <Card title="Today · P0 picks">
            <p className="text-xs text-ink-3">
              The card at the top of Today. With AI triage connected, Jev scores every item on how
              urgently it should be attacked (0–4) and the top picks win; otherwise the connectors'
              priorities decide.
            </p>
            <Row label="How many" hint="3 to 5 items.">
              <div className="flex gap-1.5">
                {[3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setP0Count(n)}
                    className={cn(
                      "press flex size-8 cursor-default items-center justify-center rounded-xl border text-xs font-semibold tabular-nums",
                      p0Count === n ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface-2 text-ink-2 hover:border-line-strong",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Window" hint="Which items compete for the top spots.">
              <div className="flex gap-1.5">
                {(Object.keys(P0_WINDOW_LABELS) as P0Window[]).map((w) => (
                  <button
                    key={w}
                    onClick={() => setP0Window(w)}
                    className={cn(
                      "press flex h-8 cursor-default items-center rounded-xl border px-2.5 text-xs font-medium",
                      p0Window === w ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface-2 text-ink-2 hover:border-line-strong",
                    )}
                  >
                    {P0_WINDOW_LABELS[w]}
                  </button>
                ))}
              </div>
            </Row>
          </Card>

          <Card title="Sync">
            <div className="flex flex-col gap-3.5 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Daily auto-refresh</p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    The inbox always refreshes when the app opens. While it stays open, it also refreshes
                    once a day at this time.
                  </p>
                </div>
                <input
                  type="time"
                  value={refreshTime}
                  onChange={(e) => e.target.value && setRefreshTime(e.target.value)}
                  className="h-8.5 shrink-0 rounded-xl border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
                <p className="text-xs text-ink-3">
                  {lastSyncAt ? `Last refreshed ${relativeTime(lastSyncAt)}` : "Not refreshed yet"}
                </p>
                <Button size="sm" onClick={() => void sync()} disabled={syncing}>
                  <RefreshCw size={13} className={cn(syncing && "animate-spin")} />
                  Refresh now
                </Button>
              </div>
            </div>
          </Card>

          <div>
            <h2 className="mb-2.5 px-1 text-[13px] font-semibold">Intelligence</h2>
            <JevCard />
            <JevPlayground />
          </div>

          <div>
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 className="text-[13px] font-semibold">Connections</h2>
              <Button size="sm" variant="ghost" onClick={startOnboarding}>
                <GraduationCap size={13} />
                Run setup guide
              </Button>
            </div>
            <div className="flex flex-col gap-2.5">
              {PROVIDER_META.map((meta) =>
                meta.id === "slack" ? (
                  <SlackCard key={meta.id} />
                ) : meta.id === "gcal" ? (
                  <CalendarCard key={meta.id} />
                ) : (
                  <ConnectionCard key={meta.id} meta={meta} />
                ),
              )}
              <AiSourceCard source="notion" />
              <AiSourceCard source="granola" />
            </div>
          </div>

          <Card title="About you">
            <p className="mb-2 text-xs text-ink-3">
              A few lines about your role, team and the services you own. Slack, Notion and the AI triage use it to judge
              what's relevant to you.
            </p>
            <textarea
              value={aboutMe ?? ""}
              disabled={aboutMe === null}
              onChange={(e) => setAboutMe(e.target.value)}
              onBlur={() => aboutMe !== null && void kvSet("about_me", aboutMe)}
              rows={3}
              placeholder="e.g. Backend engineer on the Platform team; I own the payments webhook and the sync worker."
              className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[13px] leading-5 text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
            <p className="mt-1.5 text-[11px] text-ink-3">Saved when you click away. Stored locally only.</p>
          </Card>

          <Card title="Storage">
            <div className="flex flex-col gap-2 text-[13px] text-ink-2">
              <div className="flex items-center gap-2.5">
                <Database size={15} className="shrink-0 text-ink-3" />
                <span className="truncate font-mono text-xs select-text">
                  {info ? info.db_path : "Local SQLite (available inside the Tauri app)"}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <KeyRound size={15} className="shrink-0 text-ink-3" />
                <span className="text-xs">
                  Secrets: {navigator.platform.includes("Mac") ? "macOS Keychain" : "Windows Credential Manager"}
                </span>
              </div>
              {info && (
                <p className="text-xs text-ink-3">
                  v{info.version} · {info.notification_count} notifications stored
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-line pt-3.5">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface-2 p-5 shadow-card">
      <h2 className="mb-3.5 text-[13px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}
