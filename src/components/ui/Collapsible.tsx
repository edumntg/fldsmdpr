import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

/** Titled collapsible section (used for ticket bodies, comments, summaries…). */
export function Collapsible({
  title,
  badge,
  defaultOpen = false,
  children,
  className,
}: {
  title: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-xl border border-line", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronDown
          size={13}
          className={cn("shrink-0 text-ink-3 transition-transform duration-150", !open && "-rotate-90")}
        />
        <span className="text-[12px] font-semibold text-ink-2">{title}</span>
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {open && <div className="animate-fade-in border-t border-line px-3 py-2.5">{children}</div>}
    </div>
  );
}
