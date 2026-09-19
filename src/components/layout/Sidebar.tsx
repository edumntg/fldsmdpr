import { useEffect, useRef, useState } from "react";
import {
  Inbox,
  GitPullRequest,
  CircleDot,
  Calendar,
  Bot,
  Settings,
  TerminalSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sunrise,
  Flame,
  NotebookPen,
  Sparkles,
  Loader2,
  MessageSquare,
} from "lucide-react";
import type { SectionId } from "../../lib/types";
import { useUi, sectionOrder } from "../../stores/ui";
import { useSlackAi } from "../../stores/slackAi";
import { useInbox, unreadCounts } from "../../stores/inbox";
import { useTerminal } from "../../stores/terminal";
import { useAgents, isActive } from "../../stores/agents";
import { cn, isMac, modKey } from "../../lib/utils";
import { Kbd } from "../ui/Kbd";
import { IconButton } from "../ui/IconButton";

const ICONS: Record<SectionId, typeof Inbox> = {
  today: Sunrise,
  ask: Sparkles,
  inbox: Inbox,
  prs: GitPullRequest,
  slack: MessageSquare,
  tickets: CircleDot,
  errors: Flame,
  meetings: NotebookPen,
  calendar: Calendar,
  agents: Bot,
  settings: Settings,
};

export const SECTION_LABELS: Record<SectionId, string> = {
  today: "Today",
  ask: "Ask",
  inbox: "Inbox",
  prs: "Pull Requests",
  slack: "Slack",
  tickets: "Tickets",
  errors: "Errors",
  meetings: "Meetings",
  calendar: "Calendar",
  agents: "Agents",
  settings: "Settings",
};

export function Sidebar() {
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const items = useInbox((s) => s.items);
  const showSentry = useUi((s) => s.showSentry);
  const toggleTerminal = useTerminal((s) => s.toggle);
  const agentsWorking = useAgents((s) => Object.values(s.runs).some((r) => isActive(r.status)));
  const slackEnabled = useSlackAi((s) => s.enabled);
  const slackAnalyzing = useSlackAi((s) => s.running);
  const counts = unreadCounts(items, showSentry);
  const order = sectionOrder(slackEnabled);

  // Sliding active pill: one absolutely-positioned indicator glides between rows.
  const activeIdx = order.indexOf(section);

  return (
    <aside
      data-tauri-drag-region
      className={cn(
        "vibrant flex h-full shrink-0 flex-col border-r border-line transition-[width] duration-300 ease-[var(--ease-out)]",
        sidebarCollapsed ? "w-14" : "w-60",
      )}
    >
      {/* space for macOS traffic lights (title bar overlay) */}
      <div data-tauri-drag-region className={cn("shrink-0", isMac ? "h-9" : "h-2")} />

      <div className={cn("flex items-center gap-2 px-3 pb-3", sidebarCollapsed && "justify-center px-2")}>
        {!sidebarCollapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-hover text-[11px] font-bold text-accent-fg shadow-sm">
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
          className="press mx-3 mb-4 flex h-8 cursor-default items-center gap-2 rounded-xl border border-line bg-surface-2/80 px-2.5 text-ink-3 hover:border-line-strong hover:bg-surface-2"
        >
          <Search size={14} />
          <span className="flex-1 text-left text-xs">Search…</span>
          <span className="flex gap-0.5">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      )}

      <nav className="relative flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {activeIdx >= 0 && (
          <div
            aria-hidden
            style={{ transform: `translateY(calc(${activeIdx} * (var(--row-h) + 2px)))` }}
            className="pointer-events-none absolute inset-x-2 top-0 h-[var(--row-h)] rounded-xl bg-accent shadow-sm transition-transform duration-300 ease-[var(--ease-spring)]"
          />
        )}
        {order.map((id, i) => {
          const Icon = ICONS[id];
          const active = section === id;
          const unread = counts[id] ?? 0;
          return (
            <button
              key={id}
              onClick={() => setSection(id)}
              title={`${SECTION_LABELS[id]} · ${modKey}${i + 1}`}
              className={cn(
                "press relative z-10 flex h-[var(--row-h)] shrink-0 cursor-default items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium",
                sidebarCollapsed && "justify-center px-0",
                active ? "text-accent-fg" : "text-ink-2 hover:bg-surface-3/70 hover:text-ink",
              )}
            >
              <Icon size={16} strokeWidth={2} className="shrink-0" />
              {!sidebarCollapsed && <span className="flex-1 truncate text-left">{SECTION_LABELS[id]}</span>}
              {((id === "agents" && agentsWorking) || (id === "slack" && slackAnalyzing)) && (
                <Loader2 size={13} className={cn("shrink-0 animate-spin", active ? "text-accent-fg" : "text-src-agent")} />
              )}
              {unread > 0 && (sidebarCollapsed ? (
                <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent ring-2 ring-surface" />
              ) : (
                <Badge value={unread} active={active} />
              ))}
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
          hint={`${modKey},`}
        />
      </div>
    </aside>
  );
}

/** Unread count that pops when it changes. */
function Badge({ value, active }: { value: number; active: boolean }) {
  const [pop, setPop] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setPop(true);
      const t = setTimeout(() => setPop(false), 350);
      return () => clearTimeout(t);
    }
  }, [value]);
  return (
    <span
      className={cn(
        "rounded-pill px-1.5 py-px text-[10.5px] font-semibold tabular-nums",
        active ? "bg-white/20 text-accent-fg" : "bg-accent-soft text-accent",
        pop && "animate-badge-pop",
      )}
    >
      {value}
    </span>
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
        "press flex h-[var(--row-h)] cursor-default items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium",
        collapsed && "justify-center px-0",
        active ? "bg-accent text-accent-fg shadow-sm" : "text-ink-2 hover:bg-surface-3/70 hover:text-ink",
      )}
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {!collapsed && hint && <span className={cn("text-[10px]", active ? "text-accent-fg/70" : "text-ink-3")}>{hint}</span>}
    </button>
  );
}
