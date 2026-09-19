import { Keyboard, X } from "lucide-react";
import { useUi } from "../../stores/ui";
import { Kbd } from "../../components/ui/Kbd";
import { SHORTCUTS } from "./useShortcuts";

/** `?` overlay listing every shortcut, grouped. */
export function ShortcutsHelp() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);
  if (!open) return null;

  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/25"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="animate-pop-in w-[620px] overflow-hidden rounded-2xl border border-line-strong bg-surface-2 shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <Keyboard size={16} className="text-ink-3" />
          <h2 className="flex-1 text-[14px] font-semibold tracking-tight">Keyboard shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="press cursor-default rounded-lg p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-5 px-5 py-4">
          {groups.map((g) => (
            <div key={g}>
              <h3 className="mb-2 text-[10.5px] font-semibold tracking-wide text-ink-3 uppercase">{g}</h3>
              <ul className="flex flex-col gap-1.5">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 text-[12.5px] text-ink-2">
                    <span className="min-w-0 truncate">{s.label}</span>
                    <span className="flex shrink-0 gap-0.5">
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
