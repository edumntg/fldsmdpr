import type { AppNotification } from "../../lib/types";

/** Rich context loaded lazily by detail panes (e.g. a Sentry stack trace),
 * keyed by notification id, appended to agent prompts when available. */
const promptContext = new Map<string, string>();
export const setPromptContext = (id: string, ctx: string) => promptContext.set(id, ctx);
export const getPromptContext = (id: string) => promptContext.get(id);

/**
 * Specialized high-quality reviewer prompt for PR reviews. Deliberately
 * adversarial ("assume there ARE bugs") — models hunt much harder when told
 * defects exist than when asked to "review".
 */
export function buildReviewPrompt(n: AppNotification): string {
  const num = n.meta?.number ?? "";
  const repo = n.meta?.repo ?? "";
  return [
    "You are a principal-level code reviewer with a reputation for catching bugs others miss.",
    "",
    "ASSUME THIS PR CONTAINS BUGS. It was flagged for deep review — your job is to find the defects, not to approve it.",
    "",
    `PR: ${repo} ${num} — ${n.title.replace(/^Review requested:\s*/i, "")}`,
    n.url ? `URL: ${n.url}` : null,
    "",
    "Process:",
    `1. Fetch the change: \`gh pr diff ${num.replace("#", "")}\` and \`gh pr view ${num.replace("#", "")} --json title,body,files,commits\`. Check out the branch if you need to run or trace anything.`,
    "2. Read every changed hunk and ask: what input or state breaks this? Hunt specifically for: logic errors, race conditions, unhandled error paths, off-by-one, null/undefined, resource leaks, security issues (injection, authz, secrets), API misuse, and concurrency bugs.",
    "3. Trace data flow ACROSS files — bugs hide at the boundaries between changed and unchanged code. Read the unchanged callers/callees of modified functions.",
    "4. Verify every suspicion against the actual code before reporting it. No speculative findings.",
    "5. Report findings ranked by severity. Each: file:line, the defect in one sentence, and a concrete failure scenario (inputs/state → wrong behavior). Suggest the minimal fix.",
    "6. If after genuine effort you find no defects, say exactly that and list what you verified (don't invent issues).",
    "",
    "Ignore style, naming, and formatting unless they cause a bug. Do not post anything to GitHub unless I ask.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Builds the initial agent prompt for a notification (context builder v0).
 * `extra` is appended verbatim (e.g. the Linear ticket just created for it). */
export function buildAgentPrompt(n: AppNotification, action: string, extra?: string): string {
  // PR reviews get the specialized adversarial reviewer instructions.
  if (/review/i.test(action) && (n.type === "pr_review" || n.meta?.is_pr === "true")) {
    return buildReviewPrompt(n);
  }
  const rich = promptContext.get(n.id);
  const lines = [
    `Task: ${action}`,
    "",
    `Title: ${n.title}`,
    n.meta?.repo ? `Repository: ${n.meta.repo}` : null,
    n.meta?.project ? `Project: ${n.meta.project}` : null,
    n.meta?.number ? `Reference: ${n.meta.number}` : null,
    n.url ? `URL: ${n.url}` : null,
    "",
    "Context:",
    n.snippet,
    rich ? "" : null,
    rich ?? null,
    extra ? "" : null,
    extra ?? null,
    "",
    n.source === "sentry"
      ? "Find the root cause in the codebase using the stack trace above, implement the minimal fix, and explain it. Add a regression test if the project has tests."
      : "Use the gh CLI to pull any extra context you need (diff, comments, CI logs). " +
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
