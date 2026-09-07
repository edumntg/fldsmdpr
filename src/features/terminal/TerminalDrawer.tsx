import { useEffect } from "react";
import { Plus, X, ChevronDown, Bot, TerminalSquare } from "lucide-react";
import { useTerminal } from "../../stores/terminal";
import { XtermView } from "./XtermView";
import { cn } from "../../lib/utils";
import { IconButton } from "../../components/ui/IconButton";

export function TerminalDrawer() {
  const { open, tabs, activeId, toggle, newShell, activate, close, setOpen } = useTerminal();

  // ⌘J / Ctrl+J toggles the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Hidden with CSS, not unmounted: unmounting would kill every PTY session
  // (including running Claude agents) and lose scrollback.
  if (tabs.length === 0 && !open) return null;

  return (
    <div
      className={cn(
        "animate-fade-in flex h-72 shrink-0 flex-col border-t border-line bg-surface-2",
        !open && "hidden",
      )}
    >
      {/* tab bar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => activate(t.id)}
              className={cn(
                "group flex h-7 cursor-default items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium",
                t.id === activeId ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {t.kind === "claude" ? (
                <Bot size={12} className="text-src-agent" />
              ) : (
                <TerminalSquare size={12} />
              )}
              <span className="max-w-40 truncate">{t.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.id);
                }}
                className="cursor-default rounded p-0.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                aria-label="Close tab"
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <IconButton label="New terminal" onClick={newShell} className="size-6">
            <Plus size={14} />
          </IconButton>
        </div>
        <IconButton label="Hide terminal" onClick={() => setOpen(false)} className="size-6">
          <ChevronDown size={15} />
        </IconButton>
      </div>

      {/* panes (all mounted; inactive hidden to keep scrollback) */}
      <div className="relative min-h-0 flex-1 bg-[var(--surface-2)] px-2 py-1.5">
        {tabs.map((t) => (
          <div key={t.id} className="absolute inset-0 px-2 py-1.5">
            <XtermView tab={t} active={t.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}
