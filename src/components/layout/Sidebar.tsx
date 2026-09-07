import {
  Inbox,
  GitPullRequest,
  MessageSquare,
  CircleDot,
  Calendar,
  Bot,
  Settings,
  TerminalSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import type { SectionId } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { useInbox, unreadCount } from "../../stores/inbox";
import { useTerminal } from "../../stores/terminal";
import { cn, isMac, modKey } from "../../lib/utils";
import { Kbd } from "../ui/Kbd";
import { IconButton } from "../ui/IconButton";

const NAV: { id: SectionId; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "prs", label: "Pull Requests", icon: GitPullRequest },
  { id: "slack", label: "Slack", icon: MessageSquare },
  { id: "tickets", label: "Tickets", icon: CircleDot },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "agents", label: "Agents", icon: Bot },
];

export function Sidebar() {
  const { section, setSection, sidebarCollapsed, toggleSidebar, setPaletteOpen } = useUi();
  const items = useInbox((s) => s.items);
  const toggleTerminal = useTerminal((s) => s.toggle);

  return (
    <aside
      data-tauri-drag-region
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200",
        sidebarCollapsed ? "w-14" : "w-60",
      )}
    >
      {/* space for macOS traffic lights (title bar overlay) */}
      <div data-tauri-drag-region className={cn("shrink-0", isMac ? "h-9" : "h-2")} />

      <div className={cn("flex items-center gap-2 px-3 pb-3", sidebarCollapsed && "justify-center px-2")}>
        {!sidebarCollapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-accent text-[11px] font-bold text-accent-fg">
              F
            </div>
            <span className="truncate text-[13px] font-semibold tracking-tight">FLDSMDPR</span>
          </div>
        )}
        <IconButton label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleSidebar}>
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </IconButton>
      </div>

      {!sidebarCollapsed && (
        <button
          onClick={() => setPaletteOpen(true)}
          className="mx-3 mb-4 flex h-8 cursor-default items-center gap-2 rounded-xl border border-line bg-surface-2 px-2.5 text-ink-3 transition-colors hover:border-line-strong"
        >
          <Search size={14} />
          <span className="flex-1 text-left text-xs">Search…</span>
          <span className="flex gap-0.5">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = section === id;
          const unread = unreadCount(items, id);
          return (
            <button
              key={id}
              onClick={() => setSection(id)}
              title={label}
              className={cn(
                "flex h-8.5 cursor-default items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium transition-colors duration-150",
                sidebarCollapsed && "justify-center px-0",
                active
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "text-ink-2 hover:bg-surface-3 hover:text-ink",
              )}
            >
              <Icon size={16} strokeWidth={2} className="shrink-0" />
              {!sidebarCollapsed && <span className="flex-1 truncate text-left">{label}</span>}
              {!sidebarCollapsed && unread > 0 && (
                <span
                  className={cn(
                    "rounded-pill px-1.5 py-px text-[10.5px] font-semibold tabular-nums",
                    active ? "bg-white/20 text-accent-fg" : "bg-accent-soft text-accent",
                  )}
                >
                  {unread}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-line p-2">
        <SidebarFooterItem
          icon={TerminalSquare}
          label="Terminal"
          collapsed={sidebarCollapsed}
          onClick={toggleTerminal}
          hint={`${modKey}J`}
        />
        <SidebarFooterItem
          icon={Settings}
          label="Settings"
          collapsed={sidebarCollapsed}
          active={section === "settings"}
          onClick={() => setSection("settings")}
        />
      </div>
    </aside>
  );
}

function SidebarFooterItem({
  icon: Icon,
  label,
  collapsed,
  active,
  onClick,
  hint,
}: {
  icon: typeof Settings;
  label: string;
  collapsed: boolean;
  active?: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex h-8.5 cursor-default items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium transition-colors",
        collapsed && "justify-center px-0",
        active ? "bg-accent text-accent-fg shadow-sm" : "text-ink-2 hover:bg-surface-3 hover:text-ink",
      )}
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {!collapsed && hint && <span className="text-[10px] text-ink-3">{hint}</span>}
    </button>
  );
}
