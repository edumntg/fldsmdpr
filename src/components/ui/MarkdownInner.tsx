import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternal } from "../../lib/utils";

export default function MarkdownInner({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children: kids }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              void openExternal(href);
            }}
          >
            {kids}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
