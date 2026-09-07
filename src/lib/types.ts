export type Source =
  | "github"
  | "slack"
  | "linear"
  | "gcal"
  | "agent"
  | "notion"
  | "granola"
  | "sentry";

export type NotificationType =
  | "pr_review"
  | "pr_update"
  | "mention"
  | "assigned"
  | "ai_inferred"
  | "ticket"
  | "event"
  | "incident"
  | "action_item"
  | "agent_done"
  | "agent_needs_input";

export type NotificationState = "unread" | "read" | "snoozed" | "done";

export interface Relevance {
  kind: "explicit" | "implicit";
  score: number;
  reason: string;
}

export interface AppNotification {
  id: string;
  source: Source;
  type: NotificationType;
  title: string;
  snippet: string;
  url?: string;
  createdAt: number; // unix ms
  priority: number;
  state: NotificationState;
  relevance?: Relevance;
  /** Extra display context: repo, channel, ticket key, meeting time, etc. */
  meta?: Record<string, string>;
}

export type SectionId =
  | "today"
  | "inbox"
  | "prs"
  | "slack"
  | "tickets"
  | "calendar"
  | "agents"
  | "settings";
