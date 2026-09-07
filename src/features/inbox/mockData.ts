import type { AppNotification } from "../../lib/types";

const now = Date.now();
const min = 60_000;
const hour = 60 * min;

/** Placeholder data so the shell is navigable before connectors land (Phase 1+). */
export const mockNotifications: AppNotification[] = [
  {
    id: "n1",
    source: "github",
    type: "pr_review",
    title: "Review requested: Fix OAuth token refresh race",
    snippet:
      "acme-corp/core-api #482 — Refactors the token refresh path to take a lock before rotating refresh tokens. 6 files changed, +142 −87.",
    url: "https://github.com/acme-corp/core-api/pull/482",
    createdAt: now - 12 * min,
    priority: 90,
    state: "unread",
    meta: { repo: "core-api", number: "#482", ci: "passing", author: "mchen-dev" },
  },
  {
    id: "n2",
    source: "slack",
    type: "ai_inferred",
    title: "#payments — webhook failures being discussed",
    snippet:
      "“…the payout webhook Edu built started returning 500s after the deploy, can someone from platform take a look before EOD?”",
    createdAt: now - 34 * min,
    priority: 80,
    state: "unread",
    relevance: {
      kind: "implicit",
      score: 0.86,
      reason: "Discusses the payout webhook you own; no @-mention.",
    },
    meta: { channel: "#payments", from: "Sarah K." },
  },
  {
    id: "n3",
    source: "slack",
    type: "mention",
    title: "@you in #eng-platform",
    snippet:
      "“@eduardo can you sanity-check the migration plan for the notifications table before we run it in staging?”",
    createdAt: now - 2 * hour,
    priority: 85,
    state: "unread",
    meta: { channel: "#eng-platform", from: "Dan R." },
  },
  {
    id: "n4",
    source: "linear",
    type: "ticket",
    title: "PLA-341 assigned to you: Rate-limit retry storm on sync worker",
    snippet:
      "Urgent · Cycle 14 — Sync worker hammers the GitHub API when a token expires. Add exponential backoff with jitter and a circuit breaker.",
    createdAt: now - 5 * hour,
    priority: 75,
    state: "unread",
    meta: {
      key: "PLA-341",
      priority: "Urgent",
      cycle: "Cycle 14",
      state: "In Progress",
      state_type: "started",
      state_color: "#f2c94c",
      team: "Platform",
      description:
        "## Problem\nWhen a GitHub token expires mid-sync, the worker retries immediately in a tight loop, hammering the API until the rate limit trips.\n\n## Proposal\n- Exponential backoff with jitter\n- Circuit breaker after 5 consecutive failures\n- Surface a 'reconnect GitHub' notification instead of silent retries",
      comments: JSON.stringify([
        { author: "Dan R.", body: "Seeing this in prod too — the retry storm took us to 100% of the rate limit twice today.", at: new Date(now - 3 * hour).toISOString() },
        { author: "Sarah K.", body: "+1, let's prioritize. Backoff params: base 2s, cap 5m?", at: new Date(now - 1 * hour).toISOString() },
      ]),
    },
  },
  {
    id: "n5",
    source: "gcal",
    type: "event",
    title: "Platform weekly sync",
    snippet: "Today 2:00–2:30 PM · Google Meet · 6 attendees · Agenda: cycle review, incident follow-up.",
    createdAt: now - 6 * hour,
    priority: 60,
    state: "read",
    meta: { time: "2:00 PM", link: "meet.google.com/xyz" },
  },
  {
    id: "n6",
    source: "github",
    type: "pr_update",
    title: "CI failed on your PR: Add notification dedupe pass",
    snippet:
      "acme-corp/core-api #479 — `test_dedupe_cross_source` failing on postgres 16 matrix job.",
    createdAt: now - 26 * hour,
    priority: 70,
    state: "read",
    meta: { repo: "core-api", number: "#479", ci: "failing" },
  },
  {
    id: "n7",
    source: "agent",
    type: "agent_done",
    title: "Agent finished: reviewed PR #478",
    snippet:
      "Left 4 comments — a potential N+1 in the report query and a missing null-check on the webhook payload. No blocking issues.",
    createdAt: now - 28 * hour,
    priority: 50,
    state: "read",
    meta: { session: "review-478", duration: "4m 12s" },
  },
];
