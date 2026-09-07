import type { AppNotification } from "../../lib/types";

/** Builds the initial agent prompt for a notification (context builder v0). */
export function buildAgentPrompt(n: AppNotification, action: string): string {
  const lines = [
    `Task: ${action}`,
    "",
    `Title: ${n.title}`,
    n.meta?.repo ? `Repository: ${n.meta.repo}` : null,
    n.meta?.number ? `Reference: ${n.meta.number}` : null,
    n.url ? `URL: ${n.url}` : null,
    "",
    "Context:",
    n.snippet,
    "",
    "Use the gh CLI to pull any extra context you need (diff, comments, CI logs). " +
      "Work incrementally and explain what you changed when done.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/** Worktree-safe slug, e.g. "gh-482-fix-oauth-token-refresh". */
export function worktreeName(n: AppNotification): string {
  const num = n.meta?.number?.replace("#", "") ?? "";
  const slug = n.title
    .toLowerCase()
    .replace(/^(review requested|mentioned|assigned( pr)?):\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return ["gh", num, slug].filter(Boolean).join("-");
}
