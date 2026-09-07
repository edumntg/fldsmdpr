import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";

async function openExternal(url: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}

/**
 * Renders GitHub-flavored markdown (Linear tickets, PR descriptions, Slack
 * messages) with the app's design tokens — see the `.md` styles in global.css.
 * Links open in the system browser, never navigate the webview.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md text-[13.5px] leading-6 text-ink-2 select-text", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: kids }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) void openExternal(href);
              }}
            >
              {kids}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
