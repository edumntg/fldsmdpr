import { useEffect, useState } from "react";
import { Moon, Sun, MonitorSmartphone, Database, KeyRound, RefreshCw, GraduationCap } from "lucide-react";
import { useTheme, type ThemePref } from "../../stores/theme";
import { useSync } from "../../stores/sync";
import { useOnboarding } from "../onboarding/Onboarding";
import { appInfo, type AppInfo } from "../../lib/ipc";
import { PROVIDER_META } from "../connections/providerMeta";
import { ConnectionCard } from "../connections/ConnectionCard";
import { Button } from "../../components/ui/Button";
import { cn, relativeTime } from "../../lib/utils";

export function SettingsView() {
  const { pref, setPref } = useTheme();
  const { refreshTime, setRefreshTime, lastSyncAt, sync, syncing } = useSync();
  const startOnboarding = useOnboarding((s) => s.start);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void appInfo().then(setInfo);
  }, []);

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
                    "flex h-9 flex-1 cursor-default items-center justify-center gap-2 rounded-xl border text-[13px] font-medium transition-colors",
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
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 className="text-[13px] font-semibold">Connections</h2>
              <Button size="sm" variant="ghost" onClick={startOnboarding}>
                <GraduationCap size={13} />
                Run setup guide
              </Button>
            </div>
            <div className="flex flex-col gap-2.5">
              {PROVIDER_META.map((meta) => (
                <ConnectionCard key={meta.id} meta={meta} />
              ))}
            </div>
          </div>

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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface-2 p-5 shadow-card">
      <h2 className="mb-3.5 text-[13px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}
