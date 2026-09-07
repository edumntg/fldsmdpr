import { useEffect } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { NotificationList } from "./features/inbox/NotificationList";
import { NotificationDetail } from "./features/inbox/NotificationDetail";
import { SettingsView } from "./features/settings/SettingsView";
import { CommandPalette } from "./features/palette/CommandPalette";
import { Onboarding, useOnboarding } from "./features/onboarding/Onboarding";
import { useUi } from "./stores/ui";
import { useTheme } from "./stores/theme";
import { useSync } from "./stores/sync";
import { useConnections } from "./stores/connections";

export default function App() {
  const section = useUi((s) => s.section);
  const initTheme = useTheme((s) => s.init);
  const initSync = useSync((s) => s.init);
  const refreshConnections = useConnections((s) => s.refresh);
  const maybeAutoStartOnboarding = useOnboarding((s) => s.maybeAutoStart);

  useEffect(() => {
    void initTheme();
    void initSync(); // refresh-on-open + daily scheduler
    void refreshConnections();
    void maybeAutoStartOnboarding();
  }, [initTheme, initSync, refreshConnections, maybeAutoStartOnboarding]);

  return (
    <div className="flex h-full">
      <Sidebar />
      {section === "settings" ? (
        <SettingsView />
      ) : (
        <>
          <NotificationList />
          <NotificationDetail />
        </>
      )}
      <CommandPalette />
      <Onboarding />
    </div>
  );
}
