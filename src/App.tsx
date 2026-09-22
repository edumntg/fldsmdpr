import { lazy, Suspense, useEffect } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { NotificationList } from "./features/inbox/NotificationList";
import { NotificationDetail } from "./features/inbox/NotificationDetail";
import { CommandPalette } from "./features/palette/CommandPalette";
import { Onboarding, useOnboarding } from "./features/onboarding/Onboarding";
import { TodayView } from "./features/today/TodayView";
import { Toaster } from "./components/ui/Toaster";
import { ShortcutsHelp } from "./features/shortcuts/ShortcutsHelp";
import { useShortcuts } from "./features/shortcuts/useShortcuts";
import { useUi } from "./stores/ui";
import { useTheme } from "./stores/theme";
import { useSync } from "./stores/sync";
import { useConnections } from "./stores/connections";
import { useInbox } from "./stores/inbox";
import { useAiSources } from "./stores/aiSources";
import { useTerminal } from "./stores/terminal";
import { useJev } from "./stores/jev";
import { useSlackAi } from "./stores/slackAi";
import { useProfile } from "./stores/profile";
import { checkForUpdate } from "./lib/updater";

// Off the cold-start path: settings, agents, ask (markdown) and the terminal
// (xterm + WebGL) load on first use.
const SettingsView = lazy(() => import("./features/settings/SettingsView").then((m) => ({ default: m.SettingsView })));
const AgentsView = lazy(() => import("./features/agents/AgentsView").then((m) => ({ default: m.AgentsView })));
const AskView = lazy(() => import("./features/ask/AskView").then((m) => ({ default: m.AskView })));
const FlowView = lazy(() => import("./features/flow/FlowView").then((m) => ({ default: m.FlowView })));
const TerminalDrawer = lazy(() =>
  import("./features/terminal/TerminalDrawer").then((m) => ({ default: m.TerminalDrawer })),
);

export default function App() {
  const section = useUi((s) => s.section);
  const initTheme = useTheme((s) => s.init);
  const initSync = useSync((s) => s.init);
  const reloadInbox = useInbox((s) => s.reload);
  const refreshConnections = useConnections((s) => s.refresh);
  const initAiSources = useAiSources((s) => s.init);
  const maybeAutoStartOnboarding = useOnboarding((s) => s.maybeAutoStart);
  const initJev = useJev((s) => s.init);
  const initSlackAi = useSlackAi((s) => s.init);
  const initProfile = useProfile((s) => s.init);
  const terminalMounted = useTerminal((s) => s.open || s.tabs.length > 0);

  useShortcuts();
  useDockBadge();

  useEffect(() => {
    void initTheme();
    void reloadInbox(); // show cached items instantly…
    void initSync(); // …then refresh-on-open + daily scheduler
    void refreshConnections();
    void initAiSources(); // Notion/Granola-via-claude: analyze-on-open + hourly
    void maybeAutoStartOnboarding();
    void initJev();
    void initSlackAi(); // Slack (opt-in): analyze-on-open + hourly while enabled
    void initProfile();
    void checkForUpdate(); // silent download, toast to restart
  }, [initTheme, reloadInbox, initSync, refreshConnections, initAiSources, maybeAutoStartOnboarding, initJev, initSlackAi, initProfile]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* key on section: each view rises in on switch */}
        <div key={section} className="animate-enter flex min-w-0 flex-1 bg-canvas">
          <Suspense fallback={null}>
            {section === "settings" ? (
              <SettingsView />
            ) : section === "agents" ? (
              <AgentsView />
            ) : section === "today" ? (
              <TodayView />
            ) : section === "ask" ? (
              <AskView />
            ) : section === "flow" ? (
              <FlowView />
            ) : (
              <>
                <NotificationList />
                <NotificationDetail />
              </>
            )}
          </Suspense>
        </div>
      </div>
      {terminalMounted && (
        <Suspense fallback={null}>
          <TerminalDrawer />
        </Suspense>
      )}
      <CommandPalette />
      <ShortcutsHelp />
      <Onboarding />
      <Toaster />
    </div>
  );
}

/** Unread total → macOS Dock badge (and the tab title in the browser preview). */
function useDockBadge() {
  const unread = useInbox((s) => s.items.reduce((n, i) => n + (i.state === "unread" ? 1 : 0), 0));
  useEffect(() => {
    document.title = unread ? `(${unread}) FLDSMDPR` : "FLDSMDPR";
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().setBadgeCount(unread || undefined).catch(() => {}),
    );
  }, [unread]);
}
