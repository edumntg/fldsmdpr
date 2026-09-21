import type { AppNotification } from "./types";
import { useProfile } from "../stores/profile";

/**
 * Is this item about the user specifically? Deterministic on purpose — no
 * model call:
 *  - GitHub, Linear, Sentry, Calendar, Notion, Granola and agent items are
 *    fetched scoped to the user (review-requested / assigned / mentioned /
 *    their calendar), so they're theirs by construction;
 *  - Slack mentions, DMs and their own unanswered asks are theirs;
 *  - other Slack messages count when the text names them (name, handle,
 *    email from Settings → About you) or when Jev already flagged them as
 *    relevant at fetch time (that verdict is paid once, in the fast path).
 */
export function involvesMe(n: AppNotification): boolean {
  if (n.source !== "slack") return true;
  if (n.type === "mention" || n.type === "follow_up") return true;
  if (n.meta?.kind === "dm") return true;
  const hay = `${n.title}\n${n.snippet}`.toLowerCase();
  if (useProfile.getState().tokens().some((t) => hay.includes(t))) return true;
  return n.relevance?.kind === "implicit" && n.relevance.score >= 0.6;
}
