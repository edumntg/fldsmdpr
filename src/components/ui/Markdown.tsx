import { lazy, Suspense } from "react";
import { cn } from "../../lib/utils";

// react-markdown + remark-gfm are ~150KB; nothing on the cold-start path needs
// them, so they load with the first rendered body.
const Inner = lazy(() => import("./MarkdownInner"));

/**
 * Renders GitHub-flavored markdown (Linear tickets, PR descriptions) with the
 * app's design tokens — see the `.md` styles in global.css. Links open in the
 * system browser, never navigate the webview.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md text-[13.5px] leading-6 text-ink-2 select-text", className)}>
      <Suspense fallback={<p className="whitespace-pre-wrap">{children}</p>}>
        <Inner>{children}</Inner>
      </Suspense>
    </div>
  );
}
