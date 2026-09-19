import { X, Check, AlertCircle } from "lucide-react";
import { useToasts } from "../../stores/toast";
import { cn } from "../../lib/utils";

/** Bottom-right stack of transient messages, each with an optional action (Undo…). */
export function Toaster() {
  const { toasts, dismiss } = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="animate-toast-in pointer-events-auto flex items-center gap-2.5 rounded-xl border border-line-strong bg-surface-2 py-2 pr-1.5 pl-3 text-[13px] shadow-pop"
        >
          {t.tone === "success" && <Check size={14} className="shrink-0 text-success" />}
          {t.tone === "danger" && <AlertCircle size={14} className="shrink-0 text-danger" />}
          <span className={cn("text-ink", t.tone === "danger" && "text-danger")}>{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
              className="press cursor-default rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft"
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="press cursor-default rounded-lg p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
